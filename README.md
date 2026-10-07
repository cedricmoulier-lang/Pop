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

## Phénix manga

`phenix-manga.js` est une mascotte autonome (sans dépendance) : un phénix de feu, plumage éclairé de l'intérieur et flammes animées, qui se promène sur n'importe quelle page HTML. Il vole par séries de battements (aile repliée à la remontée, rémiges écartées à la descente) entrecoupées de courts planés. Ajoutez avant `</body>` :

```html
<script src="phenix-manga.js" defer></script>
```

- Il vole, se pose sur les titres, images, boutons et éléments marqués `data-phenix-perchoir`, et reste dessus quand la page défile.
- Le curseur l'effraie ; un clic sur lui le fait s'embraser et renaître.
- Réglages : `data-taille` (pixels) et `data-perchoirs` (sélecteur CSS) sur la balise `<script>`.
- API : `Phenix.renaitre()`, `pause()`, `reprendre()`, `masquer()`, `afficher()`, `etat()`.
- Avec « réduire les animations », il reste posé et cligne des yeux.

`phenix-manga.html` est la page de démonstration.
