import { readFile } from 'fs/promises'

export default function  async () => {
  const newConfig = await JSON.parse(
    await readFile(new URL('./config.json', import.meta.url))
  )
  return newConfig
}
