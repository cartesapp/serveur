export default function photonRoute(app) {
  app.get('/dashboard', async (req, res) => {
    const {} = req.params

    res.send(['coucou'])
  })
}
