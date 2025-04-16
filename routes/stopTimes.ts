import {
  closeDb,
  getCalendarDates,
  getCalendars,
  getFrequencies,
  getRoutes,
  getShapesAsGeoJSON,
  getStops,
  getStopsAsGeoJSON,
  getStoptimes,
  getTrips,
  openDb,
} from 'gtfs'
import { rejectNullValues } from '../utils.js'

export default function addStopTimesRoute(app, config) {
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

          const idNameMap = Object.fromEntries(
            getStops({ stop_id: orderedTripStoptimeIds }).map((stop) => [
              stop.stop_id,
              stop.stop_name,
            ])
          )

          const stopNames = orderedTripStoptimeIds.map((id) => idNameMap[id])

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
          .map((route) => {
            const lines = getShapesAsGeoJSON({
              route_id: route.route_id,
            }).features

            //I'm not what are lines used for. They used to be displayed correctly by the map even if the shapes.txt was not present.
            //did we make our shapes up in the client ?
            //console.log('lines', lines, route.route_id)
            return [
              ...lines,
              ...getStopsAsGeoJSON({
                route_id: route.route_id,
              }).features,
            ]
          })
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
}
