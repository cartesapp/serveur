import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

export default function updateDashboardRoute(app) {
  app.get('/dashboard', async (req, res) => {
    const updatesDirectory = path.dirname('../updates/')
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
