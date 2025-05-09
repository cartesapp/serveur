import { download, liveExec } from './tiles.js'
import { writeUpdate } from './updateDashboardRoute.js'
const secretKey = process.env.SECRET_KEY

/* sudo vim /etc/systemd/system/photon.service
 *
[Unit]
Description=Photon

[Service]
ExecStart=java -jar /home/ubuntu/photon-0.6.2.jar -cors-any -data-dir /home/ubuntu/serveur
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
----

Check if worked 
journalctl -u photon.service -b -e -f

*/

export default function photonRoute(app) {
  app.get('/update-photon/:givenSecretKey/:noDownload?', async (req, res) => {
    const { givenSecretKey, noDownload = false } = req.params
    if (givenSecretKey !== secretKey) {
      return res
        .status(401)
        .send("Wrong auth secret key, you're not allowed to do that")
    }
    try {
      // doc here
      // https://github.com/komoot/photon?tab=readme-ov-file#installation

      /*
    const { stdout, stderr } = await exec(
      'cd ~ && wget -O -  | pbzip2 -cd | tar x'
    )
	*/

      if (!noDownload) {
        const url = `https://download1.graphhopper.com/public/photon-db-latest.tar.bz2`
        await download(url)
      }

      await liveExec('pbzip2 -cdv photon-db-latest.tar.bz2 | tar x')

      await liveExec('sudo service photon restart')

      writeUpdate('photon')
      console.log('-------------------------------')
      console.log('✅ Downloaded photon database 🌍️')
      return res.send({ ok: true })
    } catch (e) {
      console.log("Couldn't update photon.", e)
      res.send({ ok: false })
    }
  })
}
