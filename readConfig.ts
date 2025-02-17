import { readFile, writeFile } from 'fs/promises'

export async function readConfig() {
  const newConfig = await JSON.parse(
    await readFile(new URL('./config.json', import.meta.url))
  )
  return newConfig
}
export async function writeConfig(config) {
  await writeFile(
    new URL('./config.json', import.meta.url),
    JSON.stringify(config)
  )
}
