import { existsSync } from 'https://deno.land/std/fs/mod.ts'
import { load } from 'https://deno.land/std@0.224.0/dotenv/mod.ts'
import { Destination, download } from 'https://deno.land/x/download/mod.ts'
import { exec } from 'https://deno.land/x/exec/mod.ts'
import { YamlLoader } from 'https://deno.land/x/yaml_loader/mod.ts'
import { prefixGtfsAgencyIds, prefixGtfsServiceIds } from './gtfsUtils.ts'
const env = await load()
import buildMotisConfig from './buildMotisConfig.ts'

export const log = (message, color = 'lightgreen') =>
  console.log(`%c${message}`, 'color: ' + color)

const gtfsCleanFilename = 'gtfsclean'
const pathFound = existsSync(gtfsCleanFilename)
if (pathFound) log('gtfsclean already present')
else {
  log('will download gtfsclean (fork of gtfs tidy)')

  await exec(
    'wget https://github.com/public-transport/gtfsclean/releases/download/snapshot-3/gtfsclean'
  )
  await exec('chmod +x gtfsclean')
}

const yamlLoader = new YamlLoader()
const input = await yamlLoader.parseFile('./input.yaml')

const { datasets: allDatasets } = input

const onlyMeOverrides = allDatasets.filter((dataset) => dataset.onlyMe)
const datasets = (
  onlyMeOverrides.length ? onlyMeOverrides : allDatasets
).filter((dataset) => !dataset.ignore)

const afterFileDownload = async (resource, filename) => {
  log(`Downloaded file ${resource.title}`)
  // We gtfsclean everything, motis expects this and we had problems with node-gtfs before gtfstcleaning
  const extractedFileName = filename.split('.zip')[0]
  const gtfsCleanCommand = `./gtfsclean input/${filename} --fix -o input/${extractedFileName} --empty-agency-url-repl "https://transport.data.gouv.fr/datasets/${resource.slug}"`
  console.log(gtfsCleanCommand)
  await exec(gtfsCleanCommand)
  log(
    `Fixed errors with gtfssclean as requested in input for file ${resource.title}`
  )

  const path = './input/' + extractedFileName
  if (resource.prefixServiceIds)
    prefixGtfsServiceIds(path, resource.prefix + '-')

  await prefixGtfsAgencyIds(path, resource.prefix + '-')

  return { path, prefix: resource.prefix, title: resource.title }
}
const doFetch = async () => {
  const panRequest = await fetch('https://transport.data.gouv.fr/api/datasets/')
  const panDatasets = await panRequest.json()

  log(`Found ${panDatasets.length} datasets`)

  const interestingDatasets = datasets.map((dataset) => {
    const found = panDatasets.find(({ slug, page_url, id }) =>
      [slug, page_url, id].find((el) => el === dataset.slug)
    )
    //TODO implement transport.data.gouv.fr's redirection
    //but they don't have an api by slug, just by id...
    //TODO errors should be collected and displayed somewhere on the Web !
    if (found == null)
      throw new Error(
        'Erreur : le jeu de données ayant pour slug ' +
          dataset.slug +
          " n'est pas trouvable. Peut-être a-t-il été redirigé vers un nouveau slug ?"
      )
    const result = {
      ...found,
      prefix: dataset.prefix,
      auth: dataset.auth,
      prefixServiceIds: dataset.prefixServiceIds,
    }
    return result
  })

  log(
    `Among which ${interestingDatasets.length} datasets match our input rules`
  )
  const resources = interestingDatasets.reduce((memo, next) => {
    const gtfsResources = next.resources.filter(
      (resource) =>
        resource.format === 'GTFS' && //&& resource.is_available flixbus marked as not available but is in fact
        resource.community_resource_publisher == null // Some transport.data.gouv.fr entries have multiple official complementary GTFS files, e.g. breton islands.
      // Some others have intersecting resources, e.g. reseau-urbain-et-interurbain-dile-de-france-mobilites
      // It looks like intersecting, which are problematic for us, appear only with community resources
    )

    const uniqueTitle = Object.values(
      Object.fromEntries(gtfsResources.map((el) => [el.title, el]))
    )
    return [
      ...memo,
      ...uniqueTitle.map((resource) => ({
        slug: next.slug,
        auth: next.auth,
        prefix: next.prefix,
        prefixServiceIds: next.prefixServiceIds,
        ...resource,
      })),
    ]
  }, [])

  log(`Expanded to ${resources.length} resources (GTFS files)`)

  const filenames = await Promise.all(
    resources.map(async (resource) => {
      try {
        const filename =
          (resource.prefix || resource.slug) +
          '|' +
          resource.title
            .replace(/\s/g, '-')
            // eu-x-eurostar|EUROSTAR-GTFS-jusqu'au-7/10/2024.gtfs.zip
            .replace(/'/g, '-')
            .replace(/\//g, '-') +
          (resource.format === 'GTFS' ? '.gtfs.zip' : '.unknown')
        // NOTE : You need to ensure that the directory you pass exists.

        const destination: Destination = {
          file: filename,
          dir: './input',
        }
        /* sample with mode
     const destination: Destination = {
        file: 'example.pdf',
        dir: './test',
        mode: 0o777
    }
    */

        const needAuth = resource.auth
        if (needAuth) {
          console.log(
            `La resource du slug ${resource.slug} nécessite une authentification`
          )
          if (!env[needAuth])
            console.log(
              `%cErreur : l'authentification ${resource.auth} du slug ${resource.slug} est introuvable dans le .env`,
              'color: crimson'
            )
        }
        const reqInit: RequestInit = {
          method: 'GET',
          ...(needAuth
            ? {
                headers: {
                  Authorization: 'Basic ' + btoa(env[needAuth]),
                },
              }
            : {}),
        }
        // I wanted to use "url" but it sometimes is an index file, e.g. with slug "horaires-des-lignes-ter-sncf"
        // Edit : looks like this case is resolved. Trying to use this TDGV url field to use their cache, since lots of resources are sometimes unavailable
        // 2nd edit : no, the file gets downloaded, but it's an index. I was fooled for the second time.
        await download(resource.original_url, destination, reqInit)

        return afterFileDownload(resource, filename)
      } catch (err) {
        log('Erreur dans le traitement de la resource ' + resource.slug, 'red')
        log(err, 'red')
        return { title: resource.title, error: true }
      }
    })
  )

  const errorFilenames = filenames.filter((filename) => filename.error)
  if (errorFilenames.length > 0)
    log(
      'Erreurs dans le traitement de ces fichiers GTFS ' +
        errorFilenames.map((filename) => filename.title).join(' ; '),
      'red'
    )
  const validFilenames = filenames.filter((filename) => !filename.error)

  validFilenames.forEach((filename) => {
    log(
      `Found resource with path=${filename.path} and prefix=${filename.prefix}`
    )
  })

  const nodeGtfsConfigFile = './config.json'
  await Deno.writeTextFile(
    nodeGtfsConfigFile,
    JSON.stringify(
      {
        agencies: validFilenames.map(({ path, prefix }) => ({
          path,
          prefix, // slow but we need it : from 49 seconds to 1min04 on a sample dataset (Montpellier + Bretagne + Epinal)
          exclude: ['shapes'], // We don't need original shapes, they're too detailed and often wrong, we're rebuilding our own symbolical shapes
        })), // We tried using the prefix option of node-GTFS to make service_ids unique, but it rewrites STAR:1235 with bzhSTAR:1235 which breaks external discovery e.g. OSM tag of a bus stop
        ignoreDuplicates: true,
      },
      null,
      4
    )
  )
  log(`Wrote node-gtfs config file ${nodeGtfsConfigFile}`)
  try {
    await Deno.mkdir('../motis')
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err
    }
  }
  const motisConfigFile = '../motis/config.ini'
  const motisConfig = buildMotisConfig(validFilenames)
  await Deno.writeTextFile(motisConfigFile, motisConfig)
  log(`Wrote motis config file ${motisConfigFile}`)
}

await doFetch()

//await exec('PORT=3000 pm2 start "yarn start"')
