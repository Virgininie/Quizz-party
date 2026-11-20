# Quiz Party — étape 1 (quiz individuel)

## Mettre le jeu en ligne (gratuit, sur Render)
1. Créez un compte gratuit sur github.com, puis un dépôt vide ("New repository").
2. Envoyez-y tout le contenu de ce dossier (bouton "Add file > Upload files").
3. Créez un compte gratuit sur render.com, puis "New > Web Service" et choisissez votre dépôt.
4. Réglages : Build Command `npm install` — Start Command `npm start` — plan Free.
5. Une fois "Live", Render vous donne une adresse (https://xxxx.onrender.com).

## Jouer
- Sur le MacBook branché à la TV : ouvrez `https://xxxx.onrender.com/tv.html` (plein écran, touche F11 ou ⌃⌘F).
- Les joueurs scannent le QR code, saisissent un pseudo et appuient sur « Prêt ».
- Vous cliquez sur « Voir les règles » puis « Lancer la partie ».

Astuce : en plan gratuit, le site se met en veille après un moment d'inactivité ; ouvrez-le 1 minute avant la soirée.

## Modifier les questions
Fichier `questions.js` : question, 4 propositions, numéro de la bonne réponse (0 à 3).
