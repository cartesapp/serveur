const secretKey = process.env.SECRET_KEY
import { updateFranceTiles, updatePlanetTiles } from './tiles.js'
import { writeUpdate } from './updateDashboardRoute.ts'

export default function updateTilesRoute(app) {
  app.get(
    '/update-tiles/:zone/:givenSecretKey/:noDownload?',
    async (req, res) => {
      const { givenSecretKey, zone, noDownload = false } = req.params
      if (givenSecretKey !== secretKey) {
        return res
          .status(401)
          .send("Wrong auth secret key, you're not allowed to do that")
      }
      try {
        if (zone === '35') {
          await updateFranceTiles(
            ['https://osm.download.movisda.io/grid/N48E002-latest.osm.pbf'],
            '35',
            noDownload
          )
          writeUpdate('tiles-35')
          return res.send({ ok: true })
        }
        if (zone === '29') {
          await updateFranceTiles(
            ['https://osm.download.movisda.io/grid/N48E005-latest.osm.pbf'],
            '29',
            noDownload
          )
          writeUpdate('tiles-29')
          return res.send({ ok: true })
        }
        if (zone === 'france') {
          await updateFranceTiles(undefined, undefined, noDownload)
          writeUpdate('tiles-france')
          return res.send({ ok: true })
        }
        if (zone === 'planet') {
          await updatePlanetTiles()
          writeUpdate('tiles-planet')
          return res.send({ ok: true })
        }
        return res.send({ ok: false })
      } catch (e) {
        console.log("Couldn't update tiles.", e)
        res.send({ ok: false })
      }
    }
  )
}
