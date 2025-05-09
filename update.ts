import { exec as rawExec } from 'child_process'
import 'dotenv/config'
import express from 'express'
import { closeDb, importGtfs, openDb, updateGtfsRealtime } from 'gtfs'
import util from 'util'
import { buildAgencyAreas } from './buildAgencyAreas.js'
import cache from './cache.ts'
import { readConfig, writeConfig } from './readConfig.ts'
import { dateHourMinutes } from './utils.js'
export const exec = util.promisify(rawExec)
const app = express()
const secretKey = process.env.SECRET_KEY

import photonRoute from './photonRoute.ts'
import updateDashboardRoute from './updateDashboardRoute.ts'

const parseGTFS = async (newDbName) => {
  //console.time('Parse GTFS')
  const config = await readConfig()
  console.log('will load GTFS files in node-gtfs')
  config.sqlitePath = 'db/' + newDbName
  await importGtfs(config)
  await updateGtfsRealtime(config)

  await writeConfig(config)

  //console.timeEnd('Parse GTFS')
  return "C'est bon !"
}

photonRoute(app)
updateDashboardRoute(app)

app.get('/update/:givenSecretKey', async (req, res) => {
  if (secretKey !== req.params.givenSecretKey) {
    return res
      .status(401)
      .send("Wrong auth secret key, you're not allowed to do that")
  }
  try {
    console.log('GTFS update started ', new Date())
    console.log('Will build config')
    const { stdout, stderr } = await exec('npm run build-config')
    console.log('-------------------------------')
    console.log('Build config OK')
    console.log('stdout:', stdout)
    console.log('stderr:', stderr)

    // Motis is incredibly fast compared to node-GTFS
    // Hence do it first now that the data is up to date
    // TODO sudo... https://unix.stackexchange.com/questions/606452/allowing-user-to-run-systemctl-systemd-services-without-password/606476#606476
    try {
      const { stdout2, stderr2 } = await exec(
        'sudo systemctl restart motis.service'
      )
      console.log('-------------------------------')
      console.log('Restart Motis OK')
      console.log('stdout:', stdout2)
      console.log('stderr:', stderr2)
    } catch (e) {
      console.log(
        'Could not restart Motis. Could be a problem of sudo password or a test environment. Details : ',
        e
      )
    }

    const newDbName = dateHourMinutes()
    await parseGTFS(newDbName)

    console.log('-------------------------------')
    console.log(`Parsed GTFS in new node-gtfs DB ${newDbName} OK`)

    console.log(
      'Will build agency areas, long not optimized step for now, ~ 30 minutes for SNCF + STAR + TAN'
    )
    const config = await readConfig()
    //waiting to close makes all other routes unavailable because of multiple connections ?
    const db = openDb(config)
    buildAgencyAreas(db, cache)
    console.log('✅ Did build agency areas')

    try {
      const { stdout35, stderr35 } = await exec(`pm2 delete serveur`)
      console.log('-------------------------------')
      console.log('Stopped the serveur')
      console.log('stdout:', stdout35)
      console.log('stderr:', stderr35)
    } catch (e) {
      console.log(
        'Could not delete pm2 serveur, it may not have been started yet. Will start it.'
      )
    }
    //apicache.clear()
    const { stdout4, stderr4 } = await exec(
      `find db/ ! -name '${newDbName}' -type f -exec rm -f {} +`
    )
    console.log('-------------------------------')
    console.log('Removed older dbs')
    console.log('stdout:', stdout4)
    console.log('stderr:', stderr4)

    const { stdout5, stderr5 } = await exec(
      `pm2 start "npm run start" --name "serveur"`
    )
    console.log('-------------------------------')
    console.log('Restarted the serveur')
    console.log('stdout:', stdout5)
    console.log('stderr:', stderr5)

    closeDb(db)
    console.log('Done updating 😀 ', new Date())
    res.send({ ok: true })
  } catch (e) {
    console.log(
      "Couldn't update the GTFS server, or the Motis service. Please investigate.",
      e
    )
    res.send({ ok: false })
  }
})

const port = process.env.PORT || 3002
app.listen(port, () => {
  console.log(`Cartes.app udpate server listening on port ${port}`)
})
