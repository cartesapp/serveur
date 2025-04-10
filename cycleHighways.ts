import osmToGeojson from 'npm:osmtogeojson'
import { exec } from 'https://deno.land/x/exec/mod.ts'
import { parseArgs } from 'jsr:@std/cli/parse-args'

const flags = parseArgs(Deno.args, {
  boolean: ['download'],
  default: { download: true },
  negatable: ['download'],
})

const overpassRequest = `

[out:json];
area["name"="France"]->.boundaryarea;

(
nwr["cycle_network"~"FR:REV|Les Voies Lyonnaises|FR:IDF|ReVE"](area.boundaryarea);
nwr["network:type"="REV Rennes Métropole"](area.boundaryarea);
nwr[network=lcn][name~"Chronovélo |Vélostras |REV "](area.boundaryarea);


nwr[cycle_highway](area.boundaryarea);
);
(._;>;);
/*end of auto repair*/
out;
`

const buildData = async () => {
  const request = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    // The body contains the query
    // to understand the query language see "The Programmatic Query Language" on
    // https://wiki.openstreetmap.org/wiki/Overpass_API#The_Programmatic_Query_Language_(OverpassQL)
    body: 'data=' + encodeURIComponent(overpassRequest),
  })
  const json = await request.json()

  const relations = osmToGeojson(json).features.filter((feature) =>
    feature.id.startsWith('relation')
  )
  const featureCollection = {
    type: 'FeatureCollection',
    features: relations,
  }

  return featureCollection
}

const geojsonFilename = './data/raw/cycleHighways.geojson',
  pmtilesFilename = './data/pmtiles/cycleHighways.pmtiles'
if (flags.download) {
  const data = await buildData()

  await Deno.writeTextFile(geojsonFilename, JSON.stringify(data))
  console.log('Cycle highways geojson file created')
}

try {
  await Deno.lstat(geojsonFilename)
  console.log(geojsonFilename + ' exists !')
  await exec(
    `tippecanoe -zg -Z7 -o ${pmtilesFilename} --drop-densest-as-needed ${geojsonFilename} --force --include=`
  )

  console.log(pmtilesFilename + ' written !')
} catch (err) {
  if (!(err instanceof Deno.errors.NotFound)) {
    throw err
  }
  console.log('Please download the geojson file beffore procuding pmtiles !')
}
