import axios from 'axios'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

/********
 * Prerequisites :
 * wget https://github.com/protomaps/go-pmtiles/releases/download/v1.22.0/go-pmtiles_1.22.0_Linux_x86_64.tar.gz -O ~/pmtiles.tar.gz
 * mkdir ~/pmtiles
 * tar -xvf ~/pmtiles.tar.gz -C ~/pmtiles
 *
 *
 * *********
 */

import * as chalk from 'chalk'
import { MultiProgressBars } from 'multi-progress-bars'

const dryExec = async (text) => {
  console.log(text)
  return Promise.resolve({ stdout: '', stderr: '' })
}

const log = (...messages) => console.log(...messages)
export const liveExec = async (command) => {
  const promise = new Promise((resolve, reject) => {
    const child = spawn(command, [], { shell: true })

    child.stdout.on('data', function (data) {
      log('🟢stdout: ' + data.toString())
    })
    child.stderr.on('data', function (data) {
      const message = '🔴stderr: ' + data.toString()
      log(message)
      //reject(message)
    })
    child.on('close', function (code) {
      const message = 'child process exited with code ' + code
      console.log(message)
      resolve(message)
    })
  })

  return promise
}

/*
liveExec(
  'wget https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf'
)
*/

const exec = liveExec

export async function updatePlanetTiles() {
  console.log('Will download panoramax planet pmtiles')
  const url = `https://panoramax.openstreetmap.fr/pmtiles/planet.pmtiles`
  await download(url)
  // sudo because this dir is handled by www-data
  await exec('sudo mv planet.pmtiles ~/serveur/data/pmtiles/planet.pmtiles')

  console.log('-------------------------------')
  console.log('✅ Downloaded 🌍️')
}

//updateFranceTiles()

const frenchGrid10Names = ['N50E000', 'N40E010', 'N40E000', 'N50E010'],
  frenchGrid10 = frenchGrid10Names.map(
    (name) => `https://osm.download.movisda.io/grid/${name}-10-latest.osm.pbf`
  )

export async function updateFranceTiles(
  osmPbfUrls = frenchGrid10,
  outputFilename = 'hexagone-plus',
  noDownload = false
) {
  // Now france tiles

  if (!noDownload) await Promise.all(osmPbfUrls.map((url) => download(url)))

  const tilemakerMerges = osmPbfUrls.map((url, i) => {
    const filename = url.split('/').slice(-1)[0]
    const command = `tilemaker --input ${filename} --output ${outputFilename}.mbtiles --config ~/serveur/tilemaker/resources/config-openmaptiles.json --process ~/serveur/tilemaker/resources/process-openmaptiles.lua${
      i > 0 ? ' --merge' : ''
    }`

    const [program, ...args] = command.split(' ')
    console.log(program, args)
    return command
  })

  for (const command of tilemakerMerges) {
    console.log(command)
    await exec(command)
  }

  await exec(
    `~/pmtiles/pmtiles convert ${outputFilename}.mbtiles ${outputFilename}.pmtiles`
  )

  // sudo because this dir is handled by www-data
  await exec(`sudo mv ${outputFilename}.pmtiles ~/serveur/data/pmtiles/`)
  // wait until the above step is verified before deleting, we've got disk space
  //await exec('rm hexagone-plus.mbtiles')

  //await Promise.all(grid.map((zone) => exec(`rm ${zone}-10-latest.osm.pbf`)))

  console.log('Done updating 😀')
}

false &&
  (await updateFranceTiles(
    ['https://osm.download.movisda.io/grid/N48E002-latest.osm.pbf'],
    '35'
  ))

//updateTiles()

// Initialize mpb
function createProgressBar() {
  return new MultiProgressBars({
    initMessage: ' $ Example Fullstack Build ',
    anchor: 'top',
    persist: true,
    border: true,
  })
}

function download(url) {
  const mpb = createProgressBar()
  return new Promise(async (resolve, reject) => {
    const filename = url.split('/').slice(-1)[0]
    console.log('Will write', filename)
    console.log('Connecting …')
    const { data, headers } = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    })
    const totalLength = headers['content-length']

    console.log('Starting download')
    const task = 'Downloading ' + filename
    mpb.addTask(task, {
      type: 'percentage',
      barColorFn: chalk.yellow,
    })
    const total = parseInt(totalLength)

    const writer = fs.createWriteStream(path.resolve('./', filename))

    data.on('data', (chunk) =>
      mpb.incrementTask(task, { percentage: (chunk.length / total) * 1 })
    )

    data.pipe(writer)

    data.on('end', () => resolve())
  })
}

/*
download(
  'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
)
*/
