import fs from 'fs'
import path from 'path'
import { parse, stringify } from 'yaml'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const servicesFile = path.resolve(__dirname, 'services.yaml')
const servicesJson = fs.readFileSync(servicesFile, 'utf8')

const services = parse(servicesJson)

console.log('Services listed : ', services.map((el) => el.service).join(' | '))

export default function updateDashboardRoute(app) {
  app.get('/dashboard', async (req, res) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const updatesDirectory = path.resolve(__dirname, 'updates/')
    const files = fs.readdirSync(updatesDirectory)
    console.log(files)
    const yamlFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === '.yaml'
    )

    const jsonContents = yamlFiles.map((file) => {
      const filePath = path.join(updatesDirectory, file)
      const fileContent = fs.readFileSync(filePath, 'utf8')
      const jsonContent = parse(fileContent)
      return jsonContent
    })

    res.send(jsonContents)
  })
}

//writeUpdate('photon')
export function writeUpdate(serviceId) {
  const file = path.resolve(__dirname, 'updates/' + serviceId + '.yaml')

  const data = services.find((el) => el.id === serviceId)
  const newData = { ...data, last: new Date() }

  fs.writeFileSync(file, stringify(newData))
}
