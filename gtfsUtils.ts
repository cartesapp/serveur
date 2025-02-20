import { parse, stringify } from 'jsr:@std/csv'
import { log } from './buildConfig.ts'

export const prefixGtfsColumnValues = async (csvFileName, prefix, column) => {
  try {
    const textCsv = await Deno.readTextFile(csvFileName)

    const data = parse(textCsv, {
      skipFirstRow: true,
      strip: true,
    })
    const newData = data.map((line) => ({
      ...line,
      [column]: prefix + line[column],
    }))

    const newCsv = stringify(newData, {
      columns: Object.keys(newData[0]),
    })

    await Deno.writeTextFile(csvFileName, newCsv)

    console.log('Prefixed service_ids in ' + csvFileName)
  } catch (e) {
    console.log(e)
  }
}

const serviceIdFiles = ['calendar_dates.txt', 'calendar.txt', 'trips.txt']

export const prefixGtfsServiceIds = (gtfsDir, prefix) => {
  serviceIdFiles.forEach((filename) => {
    try {
      prefixGtfsColumnValues(gtfsDir + '/' + filename, prefix, 'service_id')
    } catch (e) {
      console.log('Missing file ', filename)
    }
  })
}

export async function prefixGtfsAgencyIds(gtfsDir, prefix) {
  try {
    const agenciesCsv = await Deno.readTextFile(gtfsDir + '/agency.txt')
    const agencies = parse(agenciesCsv, {
      skipFirstRow: true,
      strip: true,
    })

    const found = agencies.find((agency) => agency.agency_id.length < 3)
    if (found) {
      log(
        `Dataset ${gtfsDir} has the agency_id "${found.agency_id}" that is shorter than 3 characters. This could lead to collisions, we're prefixing all its agency_ids`,
        'violet'
      )
      prefixGtfsColumnValues(gtfsDir + '/agency.txt', prefix, 'agency_id')
      prefixGtfsColumnValues(gtfsDir + '/routes.txt', prefix, 'agency_id')
    }
  } catch (e) {
    console.log(e)
  }
}
