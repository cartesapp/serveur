import turfDistance from '@turf/distance'
import { exec as rawExec } from 'child_process'
import compression from 'compression'
import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import { readFile } from 'fs/promises'
import {
  closeDb,
  getAgencies,
  getCalendarDates,
  getCalendars,
  getFrequencies,
  getRoutes,
  getShapesAsGeoJSON,
  getStopTimeUpdates,
  getStops,
  getStopsAsGeoJSON,
  getStoptimes,
  getTrips,
  openDb,
  updateGtfsRealtime,
} from 'gtfs'
import util from 'util'
import { buildAgencySymbolicGeojsons } from './buildAgencyGeojsons.js'
import { readConfig } from './readConfig.ts'
import {
  download,
  liveExec,
  updateFranceTiles,
  updatePlanetTiles,
} from './tiles.js'
import {
  areDisjointBboxes,
  bboxArea,
  filterFeatureCollection,
  joinFeatureCollections,
  rejectNullValues,
} from './utils.js'

import placeMapRoute from './placeMap.js'

/*
// Probably disactivated because the API is not stable enough yet
// TODO reactivate it to scale
import apicache from 'apicache'
let cacheMiddleware = apicache.middleware
*/

export const exec = util.promisify(rawExec)

import { buildAgencyAreas } from './buildAgencyAreas.js'
import {
  dateFromString,
  getWeekday,
  isAfternoon,
  isLunch,
  isMorning,
} from './timetableAnalysis.js'

import cache from './cache.ts'

const runtimeCache = { agencyAreas: null }
// This because retrieving the cache takes 1 sec

cache
  .get('agencyAreas')
  .then((result) => {
    runtimeCache.agencyAreas = result // This because retrieving the cache takes 1 sec
    console.log('runtimeCache chargé depuis cache')
  })
  .catch((err) => console.log('Erreur dans le chargement du runtime cache'))

const config = await readConfig()

console.log(`Using config file `, JSON.stringify(config))

const app = express()
app.use(
  cors({
    origin: '*',
    allowedHeaders: ['range', 'if-match'],
    exposedHeaders: ['range', 'accept-ranges', 'etag'],
    methods: 'GET,OPTIONS,HEAD,PUT,PATCH,POST,DELETE',
  })
)
// Désactivation temporaire pour régler nos pb de multiples entrées db
//app.use(cacheMiddleware('20 minutes'))
app.use(compression())

/* For the french parlementary elections, we experimented serving pmtiles. See data/. It's very interesting, we're keeping this code here since it could be used to produce new contextual maps covering news. Same for geojsons. */

app.use(express.static('data/geojson'))
// This line serves for local dev, where Nginx is not installed. We're assuming that in production nginx is faster. But its CORS headers are harder to set for pmtiles. Let's use Caddy some day
app.use(express.static('data/pmtiles'))

let resultats
try {
  resultats = await JSON.parse(
    await readFile(
      new URL(
        './data/geojson/resultats-legislatives-2024.geojson',
        import.meta.url
      )
    )
  )
} catch (e) {
  console.log(
    'Les résultats du premier tour des legislatives, qui incluent les circonscriptions, ne sont pas chargées, pas grave mais allez voir data/circo.ts si ça vous intéresse'
  )
}

placeMapRoute(app)

app.get('/elections-legislatives-2024/:circo', (req, res) => {
  if (!resultats)
    return res.send("Les résultats n'ont pas été précalculés sur ce serveur")
  try {
    const { circo } = req.params

    const result = resultats.features.find(
      (feature) => feature.properties.circo === circo
    )
    res.json(result)
    closeDb(db)
  } catch (e) {
    console.error(e)
  }
})

const port = process.env.PORT || 3001

// This code enables testing quickly with yarn start our optimisations of node-gtfs
/*
const db = '0.5203060875638728'
//await parseGTFS(db)
const testConfig = await readConfig()
console.log('will load GTFS files in node-gtfs')
testConfig.sqlitePath = 'db/' + db
const areas = buildAgencyAreas(openDb(testConfig), cache, runtimeCache)
console.log(areas)
*/

app.get('/agency/geojsons/:agency_id', (req, res) => {
  try {
    const db = openDb(config)
    const { agency_id } = req.params
    const agency = getAgencies({ agency_id })[0]
    const geojsons = buildAgencySymbolicGeojsons(db, agency)
    res.json(geojsons)
    closeDb(db)
  } catch (e) {
    console.error(e)
  }
})

app.get('/buildAgencyAreas', (req, res) => {
  try {
    const db = openDb(config)
    const areas = buildAgencyAreas(db, cache, runtimeCache)
    closeDb(db)
    res.json(areas)
  } catch (e) {
    console.error(e)
  }
})

app.get('/dev-agency', (req, res) => {
  const db = openDb(config)
  const areas = buildAgencySymbolicGeojsons(db, { agency_id: '1187' })
  //res.json(areas)
  return res.json([['1187', areas]])
})

app.get('/agencies', (req, res) => {
  const { agencyAreas } = runtimeCache
  return res.json(agencyAreas)
})

app.get('/agencyAreas', async (req, res) => {
  const { agencyAreas } = runtimeCache
  return res.json(
    Object.fromEntries(
      Object.entries(agencyAreas).map(([id, data]) => {
        const polygon = data.area
        return [
          id,
          {
            ...polygon,
            properties: {
              routeTypeStats: data.routeTypeStats,
              bbox: data.bbox, // this could be derived from the polyon client side if we care more about weight
            },
          },
        ]
      })
    )
  )
})

app.get(
  '/agencyArea/:latitude/:longitude2/:latitude2/:longitude/:format/:selection?',
  async (req, res) => {
    try {
      const db = openDb(config)
      //TODO switch to polylines once the functionnality is judged interesting client-side, to lower the bandwidth client use
      const {
          longitude,
          latitude,
          latitude2,
          longitude2,
          selection,
          format = 'geojson',
        } = req.params,
        userBbox = [+longitude, +latitude, +longitude2, +latitude2]

      const { noCache } = req.query

      const selectionList = selection?.split('|')

      if (selection && noCache) {
        const agencies = getAgencies({ agency_id: selectionList })
        console.log(
          'Will build geojson shapes for ',
          selection,
          '. Agencies found : ',
          agencies
        )
        const result = agencies.map((agency) => {
          const agency_id = agency.agency_id
          const geojson =
            agency_id == '1187'
              ? buildAgencySymbolicGeojsons(db, agency_id)
              : buildAgencySymbolicGeojsons(db, agency_id, true)
          return [agency_id, { agency, geojson }]
        })

        //res.json(areas)
        return res.json(result)
      }

      const { day } = req.query

      const { agencyAreas } = runtimeCache
      if (agencyAreas == null)
        return res.send(
          `Construisez d'abord le cache des aires d'agences avec /buildAgencyAreas`
        )

      const entries = Object.entries(agencyAreas)

      const selectedAgencies = entries.filter(([id, agency]) => {
        const inSelection = !selection || selectionList.includes(id)
        if (!inSelection) return false
        const disjointBboxes = areDisjointBboxes(agency.bbox, userBbox)
        if (disjointBboxes) return false

        const bboxRatio = bboxArea(userBbox) / bboxArea(agency.bbox),
          zoomedEnough = Math.sqrt(bboxRatio) < 3,
          notTooZoomed = Math.sqrt(bboxRatio) > 0.005

        /*
        console.log(
          id,
          disjointBboxes,
          userBbox,
          agency.bbox,
          isAgencyBigEnough
        )
		*/
        return zoomedEnough && notTooZoomed
      })

      if (format === 'prefetch')
        return res.json(selectedAgencies.map(([id]) => id))
      return res.json(selectedAgencies)

      const withDistances = entries
        .map(([agencyId, agency]) => {
          const { bbox } = agency
          const isIncluded =
            longitude > bbox[0] &&
            longitude < bbox[2] &&
            latitude > bbox[1] &&
            latitude < bbox[3]
          if (!isIncluded) return false
          const bboxCenter = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
          const distance = turfDistance(
            createPoint(bboxCenter),
            createPoint([longitude, latitude])
          )
          return { agencyId, ...agency, bboxCenter, distance }
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance)

      // Return only the closest agency for now. No algorithm is perfect, so will need to let the user choose in a following iteration
      const theOne = withDistances[0].geojson

      const goodDay = day
        ? filterFeatureCollection(
            theOne,
            (feature) => feature.properties.calendarDates.date === +day
          )
        : theOne
      res.send(goodDay)
    } catch (error) {
      console.error(error)
    }
  }
)

app.get('/agency/:agency_id?', (req, res) => {
  try {
    const { agency_id } = req.params
    console.log(`Requesting agency by id ${agency_id}`)
    const db = openDb(config)
    if (agency_id == null) res.json(getAgencies())
    else res.json(getAgencies({ agency_id })[0])

    return closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

app.get('/agencyArea/:agency_id', async (req, res) => {
  const { agency_id } = req.params
  const { agencyAreas } = runtimeCache

  try {
    const result = agencyAreas[agency_id]
    return res.json(result)
  } catch (e) {
    console.log('Erreur dans /agencyArea' + agency_id)
    return res.send({ ok: false })
  }
})
app.get('/agencyBbox/:agency_id', async (req, res) => {
  const { agency_id } = req.params
  const { agencyAreas } = runtimeCache

  const result = agencyAreas[agency_id].bbox
  return res.json(result)
})

app.get('/stop/:stop_id?', (req, res) => {
  try {
    const { stop_id } = req.params
    console.log(`Requesting stop by id ${stop_id}`)
    const db = openDb(config)
    res.json(getStops({ stop_id })[0])

    return closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

app.get('/immediateStopTimes/:ids/:day/:from/:to', (req, res) => {
  try {
    const db = openDb(config)

    const { ids: rawIds, day, from, to } = req.params,
      ids = rawIds.split('|')

    const requestText = `immediate stoptimes for day ${day} date ${from} up to ${to} and stops ${req.params.ids}`
    //console.time(requestText)

    // nouvelle requête en préparation
    try {
      const stopTimesCalendar = db
        .prepare(
          `
SELECT *
FROM trips
JOIN stop_times ON trips.trip_id = stop_times.trip_id
INNER JOIN routes ON routes.route_id = trips.route_id
WHERE stop_times.stop_id = @stopId
AND stop_times.arrival_time BETWEEN @timeFrom AND @timeTo
AND (
        EXISTS (
            SELECT 1
            FROM calendar
            WHERE calendar.service_id = trips.service_id
            AND (
                (calendar.monday = 1 AND strftime('%w', @dateHyphen) = '1') OR
                (calendar.tuesday = 1 AND strftime('%w', @dateHyphen) = '2') OR
                (calendar.wednesday = 1 AND strftime('%w', @dateHyphen) = '3') OR
                (calendar.thursday = 1 AND strftime('%w', @dateHyphen) = '4') OR
                (calendar.friday = 1 AND strftime('%w', @dateHyphen) = '5') OR
                (calendar.saturday = 1 AND strftime('%w', @dateHyphen) = '6') OR
                (calendar.sunday = 1 AND strftime('%w', @dateHyphen) = '0')
            )
            AND @date BETWEEN calendar.start_date AND calendar.end_date
        )
        OR EXISTS (
            SELECT 1
            FROM calendar_dates
            WHERE calendar_dates.service_id = trips.service_id
            AND calendar_dates.date = @date
            AND calendar_dates.exception_type = 1
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM calendar_dates
        WHERE calendar_dates.service_id = trips.service_id
        AND calendar_dates.date = @date
        AND calendar_dates.exception_type = 2
    );
`
        )
        .all({
          stopId: ids[0],
          date: day,
          dateHyphen:
            day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8),
          timeFrom: from,
          timeTo: to,
        })

      closeDb(db)
      return res.json(stopTimesCalendar.map(rejectNullValues))
    } catch (e) {
      console.error('oups', e)
      closeDb(db)
    }
    closeDb(db)
  } catch (e) {
    console.error(e)
  }
})

app.get('/stopTimes/:ids/:day?', (req, res) => {
  try {
    const ids = req.params.ids.split('|')
    // TODO implement this, to reduce radically the weight of the payload returned to the client for the basic usage of displaying stop times at the present or another future date
    const day = req.params.day

    const db = openDb(config)
    const results = ids.map((id) => {
      const timeKey = 'stoptimes ' + id
      //console.time(timeKey)
      const stops = getStoptimes({
        stop_id: [id],
      })
      const stopTrips = stops.map((stop) => stop.trip_id)

      const trips = getTrips({ trip_id: stopTrips }).map((trip) => {
        const { trip_id, service_id } = trip

        const orderedTripStoptimeIds = getStoptimes(
          { trip_id },

          ['stop_id'],
          [['stop_sequence', 'ASC']]
        ).map((stoptime) => stoptime.stop_id)
        const stopNames = getStops({ stop_id: orderedTripStoptimeIds }).map(
          (stop) => stop.stop_name
        )

        const destination = stopNames[stopNames.length - 1],
          origin = stopNames[0]

        return {
          ...trip,
          frequencies: getFrequencies({ trip_id }),
          calendar: getCalendars({ service_id }),
          calendarDates: getCalendarDates({ service_id }),
          destination,
          origin,
          //realtime: getStopTimeUpdates({ trip_id: trip.trip_id }),
        }
      })

      const tripRoutes = trips.reduce(
        (memo, next) => [...memo, next.route_id],
        []
      )

      const routes = getRoutes({ route_id: tripRoutes }).map((route) => ({
        ...route,
        tripsCount: trips.filter((trip) => trip.route_id === route.route_id)
          .length,
      }))

      //console.timeEnd(timeKey)
      const shapesTimeKey = 'shapes ' + id
      //console.time(shapesTimeKey)
      const features = routes
        .map((route) => [
          ...getShapesAsGeoJSON({
            route_id: route.route_id,
          }).features,
          ...getStopsAsGeoJSON({
            route_id: route.route_id,
          }).features,
        ])
        .flat()
      //console.timeEnd(shapesTimeKey)

      const result = {
        stops: stops.map(rejectNullValues),
        trips: trips.map(rejectNullValues),
        routes,
        features,
      }
      return [id, result]
    })

    res.json(results)
    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

app.get('/realtime/getStopTimeUpdates', async (req, res) => {
  const db = openDb(config)
  await updateGtfsRealtime(config)
  res.json(getStopTimeUpdates())
  return closeDb(db)
})

app.get('/routes/trip/:tripId', (req, res) => {
  try {
    const tripId = req.params.tripId
    const db = openDb(config)
    const routeIds = getTrips({ trip_id: [tripId] }).map((el) => el.route_id)
    const routes = getRoutes({
      route_id: routeIds,
    })
    res.json({ routes })

    //  closeDb(db);
  } catch (error) {
    console.error(error)
  }
})

app.get('/route/:routeId', (req, res) => {
  const { routeId: route_id } = req.params
  try {
    const db = openDb(config)
    const route = getRoutes({ route_id })[0]
    const trips = getTrips({ route_id })
    const times = getStoptimes({
      trip_id: trips.map((trip) => trip.trip_id),
    }).map((el) => {
      const h = +el.departure_time.slice(0, 2)
      return {
        ...el,
        debugSchool:
          isMorning(h) || isAfternoon(h) || isLunch(h)
            ? 'school'
            : 'not school',
        isMorning: isMorning(h),
        isAfternoon: isAfternoon(h),
        isLunch: isLunch(h),
      }
    })
    const calendarDates = getCalendarDates({
      service_id: trips.map((el) => el.service_id),
    }).map((el) => {
      const day = {
        ...el,
        date_o: dateFromString('' + el.date),
        weekday: getWeekday(dateFromString('' + el.date)),
      }
      return day
    })

    res.json({ route, trips, calendarDates, times })
    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})
app.get('/routes/:routeIds', (req, res) => {
  const { routeIds } = req.params
  try {
    const db = openDb(config)
    const routes = getRoutes({ route_id: routeIds.split('|') })
    res.json(routes)
    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

app.get('/geojson/route/:routeid', (req, res) => {
  try {
    const { routeId } = req.params
    const { day } = req.query

    const db = openDb(config)

    const trips = db
      .prepare(
        `SELECT trips.trip_id
FROM trips
JOIN calendar_dates ON trips.service_id = calendar_dates.service_id
WHERE trips.route_id = '${routeId}' AND calendar_dates.date = '${day}'
			  ` //AND end_date >= $date'
      )
      //JOIN shapes ON trips.shape_id = shapes.shape_id
      .all({ day })

    const featureCollections = trips.map(({ trip_id }) =>
      getShapesAsGeoJSON({ trip_id })
    )

    return res.json(joinFeatureCollections(featureCollections))

    const shapesGeojson = getShapesAsGeoJSON({
      route_id: req.params.routeId,
    })
    res.json(shapesGeojson)
    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})
app.get('/geojson/shape/:shapeId', (req, res) => {
  try {
    const { shapeId } = req.params

    const db = openDb(config)

    const result = getShapesAsGeoJSON({ shape_id: shapeId })

    res.json(result)

    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

app.get('/geoStops/:lat/:lon/:distance', (req, res) => {
  try {
    const db = openDb(config)

    const { lat, lon, distance = 20 } = req.params

    //console.log('Will query stops for lat ', lat, ' and lon ', lon)

    const results = getStops(
      {
        stop_lat: lat,
        stop_lon: lon,
      },
      [],
      [],
      { bounding_box_side_m: distance }
    )

    res.json(
      results
        // Filters location_type=(0|null) to return only stop/platform
        .filter((stop) => {
          return !stop.location_type
        })
        .map((stop) => ({
          ...stop,
          distance: turfDistance([lon, lat], [stop.stop_lon, stop.stop_lat]),
        }))
        .sort((a, b) => a.distance - b.distance)
        .map(rejectNullValues)
    )

    closeDb(db)
  } catch (error) {
    console.error(error)
  }
})

const secretKey = process.env.SECRET_KEY

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
        return res.send({ ok: true })
      }
      if (zone === '29') {
        await updateFranceTiles(
          ['https://osm.download.movisda.io/grid/N48E005-latest.osm.pbf'],
          '29',
          noDownload
        )
        return res.send({ ok: true })
      }
      if (zone === 'france') {
        await updateFranceTiles(undefined, undefined, noDownload)
        return res.send({ ok: true })
      }
      if (zone === 'planet') {
        await updatePlanetTiles()
        return res.send({ ok: true })
      }
      return res.send({ ok: false })
    } catch (e) {
      console.log("Couldn't update tiles.", e)
      res.send({ ok: false })
    }
  }
)
app.get('/update-photon/:givenSecretKey', async (req, res) => {
  const { givenSecretKey } = req.params
  if (givenSecretKey !== secretKey) {
    return res
      .status(401)
      .send("Wrong auth secret key, you're not allowed to do that")
  }
  try {
    // https://github.com/komoot/photon?tab=readme-ov-file#installation
    /*
    const { stdout, stderr } = await exec(
      'cd ~ && wget -O -  | pbzip2 -cd | tar x'
    )
	*/
    const url = `https://download1.graphhopper.com/public/photon-db-latest.tar.bz2`
    await download(url)

    await liveExec(
      'mv photon-db-latest.tar.bz2 ~/ && cd ~ / && pbzip2 -cd photon-db-latest.tar.bz2 | tar x'
    )

    console.log('-------------------------------')
    console.log('✅ Downloaded photon database 🌍️')
    return res.send({ ok: true })
  } catch (e) {
    console.log("Couldn't update photon.", e)
    res.send({ ok: false })
  }
})

app.listen(port, () => {
  console.log(`Cartes.app GTFS server listening on port ${port}`)
})
