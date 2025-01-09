import util from 'util'
import { exec as rawExec } from 'child_process'
export const exec = util.promisify(rawExec)
import fs from 'fs'

// TODO use local style to avoid a download every time
// const style = franceStyle(true)

const userDir = '/home/ubuntu'
const placeMapDir = userDir + '/.placeMapImages/'

export default function placeMapRoute(app) {
  app.get('/placeMap', async (req, res) => {
    const { zoom = 15, lat, lon, bearing = 0, pitch = 0 } = req.query

    const hash =
      placeMapDir + [zoom, lat, lon, bearing, pitch].join('-') + '.png'
    try {
      const file = fs.readFileSync(hash)
      if (file)
        return new Response(file, { headers: { 'content-type': 'image/png' } })
    } catch (e) {
      console.log(e)
    }

    const { stdout, stderr } = await exec(
      `xvfb-run -a ${userDir}/mbgl-render --style http://cartes.app/api/styles --output ${hash} -z ${zoom} -x ${lon} -y ${lat} -b ${bearing} -p ${pitch}` // && xdg-open out.png`
    )

    //    const newFile = fs.readFileSync(hash)

    console.log('-------------------------------')
    console.log('maplibre place map generation')
    console.log('stdout:', stdout)
    console.log('stderr:', stderr)

    return res.sendFile(hash)
  })
}
