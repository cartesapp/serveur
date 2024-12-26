# Le serveur Cartes.app

Contrairement à ce que son nom indique pour l'instant, ce dépôt va beaucoup plus loin que de ne gérer que les GTFS.

## Serveur de tuiles

Le plan, c'est de ne générer pour l'instant que les PMTiles (Protomaps) de la France hexagonale, et de compléter le reste du monde avec un autre serveur de tuiles PMTiles.

Donc :

- ne générer que la France de notre côté, on veut du openmaptiles pour être standard
- utiliser un proxy maison (sur cartesapp/cartes/...CartesProtocol) qui redirige soit sur notre pmtiles pour 90% des requêtes, soit un pmtiles mondial
- inclure un land.pmtiles depuis [cette source](https://osmdata.openstreetmap.de/data/land-polygons.html) car les mers ne sont plus includes dans les tuiles de la France !
- mon serveur (ses 16go de RAM ?) plante sur tilemaker du france.osm.pbf... [Normal](https://github.com/systemed/tilemaker/issues/57), et l'option --store rend la chose hyper trop lente...
- donc on calcule les tuiles en local pour l'instant et on upload via scp

Télécharger et compiler [tilemaker](https://github.com/systemed/tilemaker), voir leur [install.md](https://github.com/systemed/tilemaker/blob/master/docs/INSTALL.md)

```
wget https://download.geofabrik.de/europe/france-latest.osm.pbf
tilemaker --input france-latest.osm.pbf --output france.mbtiles
wget https://github.com/protomaps/go-pmtiles/releases/download/v1.20.0/go-pmtiles_1.20.0_Linux_x86_64.tar.gz
mkdir pmtiles
tar -xvf go-pmtiles_1.20.0_Linux_x86_64.tar.gz -C pmtiles
./pmtiles/pmtiles convert france.mbtiles france.pmtiles
scp -r tilemaker/france.pmtiles root@51.159.173.121:/root/serveur/data/pmtiles/france.pmtiles
```

```
ogr2ogr -t_srs EPSG:4326 land.json land-polygons-split-4326/land_polygons.shp
tippecanoe -zg --projection=EPSG:4326 -o land.pmtiles -l land land.json
```

landcover.pmtiles depuis https://github.com/wipfli/h3-landcover/

MAJ : j'ai trouvé un moyen de générer un périmètre plus grand autour de la France.

```
wget https://osm.download.movisda.io/grid/N50E000-10-202408071900.osm.pbf &
wget https://osm.download.movisda.io/grid/N40E010-10-202408071900.osm.pbf &
wget https://osm.download.movisda.io/grid/N40E000-10-202408071900.osm.pbf &
wget https://osm.download.movisda.io/grid/N50E010-10-202408071900.osm.pbf &
```

Puis les transformer en MBTiles, la seule méthode que j'ai trouvée est le --merge de tilemaker.

```
tilemaker --input N50E010-10-202407310700.osm.pbf --output hexagone-plus.mbtiles --config ~/serveur/tilemaker/resources/config-openmaptiles.json --process ~/serveur/tilemaker/resources/process-openmaptiles.lua
tilemaker --input NN50E000-10-202407310700.osm.pbf --output hexagone-plus.mbtiles --config ~/serveur/tilemaker/resources/config-openmaptiles.json --process ~/serveur/tilemaker/resources/process-openmaptiles.lua --merge
# pareil pour les 2 autres

```

Aussi, mieux vaut télécharger le pmtiles de Panoramax plutôt que de taper sur leur serveurs. Pour le reste du monde, on n'a pas besoin d'une fréquence de MAJ élevée.

```
wget https://panoramax.openstreetmap.fr/pmtiles/planet.pmtiles
```

### Réseaux express vélo

Dans le fichier [cycleHighways](https://github.com/cartesapp/serveur/blob/master/cycleHighways.ts#L13-L26) sont définies les requêtes OSM qui renvoient les REV. En effet, ces derniers ne sont pas encore structurés par la communauté OSM en un seul tag national, voir [cette discussion](https://forum.openstreetmap.fr/t/numerisation-des-reseaux-velo-structurants/17214).

À vous d'ajouter les réseaux de votre ville pour qu'ils s'affichent sur la carte comme une infrastructure de premier niveau. C'est un changement relativement discret qui fait pourtant toute la différence en matière de planification des transports. On voit notamment qu'à date de décembre 2024, Rennes pêche énormément par le manque de REV *dans* la ville coeur alors que ses accès depuis la métropole sont plutôt bons. 

![image](https://github.com/user-attachments/assets/09d1cd3a-a2ab-48d7-ab50-8e0b3508bf5c)



## API des horaires et lignes de bus en France (standard GTFS)

On utilise node-gtfs pour parser et servir les bons JSON pour répondre aux besoins de [Cartes.app](https://github.com/cartesapp/cartes/issues/162).

Ce dépôt est aussi celui où on va lister et récupérer les GTFS qui nous intéressent avec un script Deno. Il est donc la source des données pour [cartesapp/motis](https://github.com/cartesapp/motis), qui lui gère le routage.

### Couverture

Au départ, je suis parti sur une couverture de l'ouest de la France. La plus belle région du pays mérite ça :p. Ensuite, à l'occasion de [la conférence OSM 2024 à Lyon](https://peertube.openstreetmap.fr/w/oJwaAP1PbeLsK2zywTzLga), l'AURA et Lyon ont été ajoutés. D'autres contributeurs ont ensuite ajouté Strasbourg, Metz, Blois, etc.

Nouveau : une page donne l'[état des lieux de la couverture nationale](https://cartes.app/transport-en-commun).

Vous êtes développeur ou bidouilleur et vous aimeriez que votre territoire y soit ? Allons-y !

C'est assez simple : il faut ajouter une ligne dans le fichier [input.yaml](https://github.com/cartesapp/serveur/blob/master/input.yaml). Vous y trouverez en début de fichier une petite documentation.

> À noter, nous n'avons pas encore de branches déployées automatiquement pour chaque PR. Il faudra donc mettre en ligne sur `master` et attendre le déploiement pour ensuite tester les transports en commun sur votre territoire, et ça passe forcément par @laem, pingez-moi dans les PR. Comme vous pouvez le voir plus bas dans #déploiement, j'ai tenté de déployer tout ça sur un SaaS, mais c'est trop compliqué pour l'instant... Quand on aura le temps, il faudra automatiser tout ça et trouver un moyen de déployer ce serveur de façon plus décentralisée.

Lancer le calcul sur votre machine avec les instructions suivantes est possible, mais le pré-calcul des itinéraires marche et vélo (modules PPR et OSRM de Motis), nécessaire pour tester les calculs de transport en commun (pour aller jusqu'à la station de bus il faut marcher ou prendre le vélo), prend beaucoup de temps et nécessite 32 Go de RAM. Si vous voulez tester, pinguez-moi je vous mettrai à dispo un fichier à télécharger.

### Faire tourner ce serveur en local

Toutes les étapes sont résumées dans [la route `update` du `server.js`](https://github.com/cartesapp/serveur/blob/master/server.js#L575).

Donc quand le serveur tourne, charger `/update` va relancer le téléchargement, l'intégration dans Motis et le calcul des plans de transport !

D'abord lancer le téléchargement des fichiers GTFS et la création de la configuration node-GTFS.

Ça nécessite d'installer [node](https://nodejs.org) via [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating), [pm2](https://pm2.keymetrics.io/), [Deno](https://deno.com/) et [cartesapp/motis](https://github.com/cartesapp/motis).

Le dossier cartesapp/motis doit être installé à côté de ce dossier GTFS.

### Déploiement

Actuellement, j'ai un serveur Scaleway qui me coûte 80€/mois pour faire tourner cartesapp/serveur et cartesapp/motis. C'est assez simple à gérer : je développe en local et je fais des `git pull` quand nécessaire (changement de code) puis un `pm2 delete 0 && PORT=3001 pm2 start "npm run start"` ou je tape l'URL `/update` pour lancer une MAJ des réseaux de transport si ce n'est que ça, et le résultat peut être suivi via `pm2 logs --raw --lines 50`.

Vous moquez pas, on vise l'efficacité pour innover côté UI avant d'atteindre le graal du devops justifié par des millions d'utilisateurs ;)

Pour garantir une fraicheur régulière, j'ai un micro-script sur Deno Deploy qui comporte juste ce code :

```
Deno.cron("Update GTFS for node-GTFS and Motis","0 */6 * * *", () => {
fetch('https://motis.cartes.app/gtfs/update')
});
```

C'est une solution temporaire qui me va bien, mais qui devra évidemment être améliorée !

Au 11 juillet 2024, avec les réseaux Bretagne + PdlL + Lyon + Aura + quelques autres petits, on est sur un temps de téléchargement des GTFS + intégration à node-GTFS + création des plans de transport en commun + parsing Motis d'environ 10 minutes. Ça me semble tolérable, mais il y a des tas d'améliorations possibles :

- on va retélécharger des GTFS et les recalculer 2x par jour même s'ils n'ont pas changé ! C'est bête, mais ça marche. Pour améliorer ça, il faudra s'assurer de supprimer de la BDD node-GTFS les entrées d'un réseau qui a changé, c'est pas trivial. Je ne sais pas comment Motis le gère...
- Motis ingère les GTFS à une vitesse 10 x celle de node-GTFS, je leur en ai fait une issue
- j'ai un peu optimisé notre création de plans de transport (ce qui passe par une création de _shapes_ GTFS symboliques pour pallier à la médiocrité des shapes des AOM) mais on peut aller plus loin

#### Déployer sur un Saas

J'ai d'abord testé Scalingo. Ça marche, mais à chaque déploiement il faut repeupler la DB, et ça commence à prendre beaucoup de temps. Les PaaS sont donc limitantes, et plus chères qu'un simple VPS.

Clairement, le VPS ne tiendra pas à terme, mais pour commencer c'est bien.

J'ai voulu déployer de dépôt en edge computing. Turso.tech permettrait de stocker la DB, et Deno de déployer le serveur. Mais Deno ne peut pas encore faire tourner node-gtfs, du à des incompatibilités de packages. Faudrait changer beaucoup node-GTFS pour le faire marcher.

Deuxième problème, node-GTFS utilise better-sqlite3, et c'est donc une API différente de ce qu'utilisent Turso ou encore Fly.io. Il faudrait l'adapter pour accepter d'autres ORM, en gros.

Dernier point : node-GTFS ne fait pas le café, juste une API de recherche dans les GTFS. Ainsi il doit être couplé à Motis. Ce dernier pourrait remplacer node-GTFS, mais on en est loin je crois à ce stade et la documentation est lacunaire.

Ainsi, héberger node-GTFS et Motis sur le même serveur VPS est intéressant. Surtout que la sécurisation de ce serveur, on s'en fout, il n'y a rien de confidentiel.

Resterait donc à fusionner laem/motis et laem/serveur, pour mettre en commun le dépôt et surtout la gestion des GTFS à télécharger et mettre à jour avec un CRON.

Ensuite, trouver un moyen de déployer plusieurs serveurs pour scaler, ou retester l'expérience PaaS ou Edge, mais on verra ça quand on aura du succès.

Pour lancer :

```
PORT=3001 pm2 start "npm run start"
```

Puis lancez la création de la DB par node-GTFS. Prend plusieurs minutes pour juste l'ouest de la France (config au moment où j'écris ces lignes).

```
localhost:3001/fetch
```

Regardez si ça marche

```
pm2 monit
```

La disponibilité des différents services est disponible [ici](https://cava.cartes.app/status/cartes)
