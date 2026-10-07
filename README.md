# Pop — Portions de poisson

Calculateur de la quantité de poisson par personne et par repas.

Ouvrez `index.html` dans un navigateur : aucune dépendance, aucun serveur nécessaire.

## Ce que fait l'outil

À partir de la découpe, du type de repas, de l'appétit et du nombre de convives, il donne :

- la portion par adulte (les enfants de 3 à 11 ans comptent pour une demi-portion) ;
- le détail adultes / enfants ;
- le poids total à acheter, arrondi aux 50 g supérieurs.

## Barème utilisé (par adulte, plat principal)

| Découpe | Fourchette | Retenu |
|---|---|---|
| Poisson entier, non vidé | 400 – 500 g | 450 g |
| Poisson entier, vidé | 300 – 350 g | 320 g |
| Darne ou tranche | 200 – 250 g | 220 g |
| Filet avec peau | 170 – 200 g | 180 g |
| Filet ou pavé sans peau | 150 – 180 g | 160 g |

Coefficients : entrée × 0,5 ; buffet × 0,6 ; appétit léger × 0,8 ; grosse faim × 1,25 ; enfant × 0,5.

Les valeurs sont modifiables dans le tableau `CUTS` et l'objet `MEAL` en tête du script de `index.html`.

## Phénix

`phoenix.html` est une animation autonome (canvas, sans dépendance) : un phénix de flammes renaît de son nid de braises, prend son envol, puis se consume, en boucle de 20 secondes.

- Le phénix suit le curseur ou le doigt ; un clic (ou la touche R) le fait renaître.
- La frise du bas permet de sauter à une phase : cendres, embrasement, envol, combustion.
- Espace met en pause. Avec « réduire les animations » activé, la page s'ouvre en pause.

## Phénix qui se promène sur la page

`phenix.js` est une mascotte en 3D : un phénix de feu modélisé avec three.js, qui se promène sur n'importe quelle page HTML. Placez `phenix.js` et `phenix-2d.js` à côté de la page et ajoutez avant `</body>` :

```html
<script src="phenix.js" defer></script>
```

Le script charge three.js 0.170 (environ 170 Ko compressés) depuis jsDelivr, ou unpkg en secours. Si WebGL ou le réseau manquent, il charge `phenix-2d.js`, la version dessinée en 2D, qui se comporte de la même façon. `phenix-2d.js` s'utilise aussi seul, sans dépendance.

- Modèle 3D : corps et cou d'un seul tenant, tête avec bec crochu, yeux et arcades ; ailes articulées à l'épaule, au coude et au poignet, avec une quarantaine de plumes chacune (rémiges, couvertures) ; queue de 12 rectrices et 3 longues plumes souples ; aigrette ; pattes et serres. Chaque plume a sa texture (rachis, barbes, fentes) et capte la lumière.
- Vol : séries de battements (aile repliée à la remontée, rémiges écartées à la descente) et courts planés. Pour changer de direction, il pivote dans la profondeur en s'inclinant, le plus souvent en faisant face au spectateur.
- Il se pose de trois quarts sur les titres, images, boutons et éléments marqués `data-phenix-perchoir`, ailes repliées contre les flancs, et reste dessus quand la page défile ; il suit le curseur du regard et étire parfois les ailes.
- Au centre de l'écran, il vole sur place, ou il traverse l'écran : il s'enfonce dans la profondeur, fait demi-tour au loin, revient droit sur le spectateur comme un avion, ailes tendues, et passe derrière la caméra avant de revenir par un bord.
- Des flammes s'échappent de son plumage ; le curseur l'effraie ; un clic sur lui le fait s'embraser et renaître.
- Réglages : `data-taille` (pixels) et `data-perchoirs` (sélecteur CSS) sur la balise `<script>`.
- API : `Phenix.traverser()`, `auCentre()`, `renaitre()`, `pause()`, `reprendre()`, `masquer()`, `afficher()`, `etat()`. Les appels faits pendant le chargement sont rejoués ensuite.
- Avec « réduire les animations », il reste posé et cligne des yeux.

`phenix-demo.html` est la page de démonstration.
