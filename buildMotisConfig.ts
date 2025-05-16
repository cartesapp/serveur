import { parse, stringify } from 'jsr:@std/yaml'

const baseConfig = parse(`

server:
  port: 8080
  web_folder: ui
osm: input/europe.osm.pbf
#street_routing:
#  elevation_data_dir: srtm/
#geocoding: true
osr_footpath: true
`)

export default function (validFilenames) {
  const datasetEntries = validFilenames.map((filename) => {
    const key = filename.path.split('/')[2].split('.gtfs')[0]
    const path = `../serveur/${filename.path}`
    return [
      key,
      {
        path,
      },
    ]
  })

  const withDatasets = {
    ...baseConfig,
    timetable: { datasets: Object.fromEntries(datasetEntries) },
  }

  const yaml = stringify(withDatasets)
  return yaml
}
