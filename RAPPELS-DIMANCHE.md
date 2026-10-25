# Rappels du dimanche — installation sans terminal

La fonctionnalité est prête dans les fichiers. Il reste à installer les deux tables dans Cloudflare, importer la mise à jour sur GitHub et ajouter la planification ci-dessous. Aucun rappel réel n’a été envoyé pendant les tests.

## 1. Cloudflare : préparer la base avant de publier le code

Dans **Cloudflare → D1 → VitaminBoostALR Database → Console**, exécuter les trois instructions du fichier `migrations-legacy/0006_weekly_reminders.sql`. Elles créent les tables `vb_reminder_subscriptions`, `vb_weekly_reminders` et leur index. Elles peuvent être exécutées une par une et répétées sans effacer les données.

Le dossier livré contient aussi **2-installation-D1.sql**, avec ces instructions suivies de l’enregistrement de la migration. Après les trois créations, exécuter la dernière instruction pour enregistrer la migration.

Vérifier ensuite, dans une requête séparée :

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN('vb_reminder_subscriptions','vb_weekly_reminders') ORDER BY name;
```

Le résultat doit contenir les deux noms. Les anciennes commandes restent intactes.

## 2. GitHub : importer les fichiers

Dans **Arumia10/ALR-Smoothies → Add file → Upload files**, importer le **contenu** de `1-fichiers-GitHub` à la racine du dépôt en conservant les dossiers `public`, `cloudflare`, `lib`, `migrations-legacy` et `tests`. Valider avec **Commit changes**. Les fichiers sont remplacés ou ajoutés, pas le dossier entier du site.

Le fichier `wrangler.jsonc` existant n’est pas remplacé par ce dossier : il contient vos paramètres de production. Garder notamment le nom `vitaminboostalr`, l’identifiant D1, les variables réelles et les secrets déjà configurés.

## 3. GitHub : activer la planification Cloudflare

Ouvrir **wrangler.jsonc → crayon**. Ajouter cette propriété au niveau principal, par exemple juste après la ligne `"preview_urls": false,` :

```json
"triggers": { "crons": ["* 8-21 * * SUN"] },
```

Si une propriété `triggers` existe déjà, ajouter cette expression dans son tableau `crons` au lieu de créer une deuxième propriété. Ne pas remplacer le reste du fichier. Valider avec **Commit changes**.

Cloudflare planifie en UTC ; le code vérifie l’heure locale `Europe/Luxembourg` et commence les envois à **10 h le dimanche**, en été comme en hiver. La vérification chaque minute sert aussi à terminer les lots et à reprendre les erreurs temporaires : elle ne produit pas un nouvel e-mail à chaque passage. [Documentation Cloudflare](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Attendre que le dernier déploiement soit réussi. Dans **Workers & Pages → vitaminboostalr → Settings → Triggers / Cron Triggers**, vérifier que la planification apparaît. Sa propagation peut prendre quelques minutes.

Les paramètres existants nécessaires sont `ORDER_MODE=live`, `LIVE_SETUP_CONFIRMED=true`, `PUBLIC_ORIGIN=https://vitaminboostalr.com`, `EMAIL_FROM` et le secret `RESEND_API_KEY`. Aucun nouveau secret n’est nécessaire. Les secrets restent dans Cloudflare.

## Ce que voit le client

Avant la confirmation, une case cochée propose : **« Recevoir un rappel chaque dimanche à 10 h pour commander. »** Le client peut la décocher ; cela ne bloque pas sa commande. Le choix est enregistré seulement si la commande réelle est acceptée.

Le rappel contient son prénom, un bouton vers le menu et un lien de désinscription. Un clic ouvre une page de confirmation ; le bouton de désinscription arrête les prochains rappels. Les commandes déjà enregistrées ne changent pas. Les boutons de désinscription proposés par les messageries sont également pris en charge.

Une adresse e-mail reçoit au maximum un rappel par dimanche. Plusieurs commandes ne créent pas plusieurs abonnements. Le choix lors d’une nouvelle commande remplace le précédent ; renvoyer une ancienne requête de commande ne réactive pas un abonnement supprimé. Les clients historiques ne sont pas inscrits automatiquement. Les inscriptions après 10 h démarrent le dimanche suivant.

Les envois commencent à 10 h, par lots de 20 par minute pour respecter le service d’e-mail. Selon le nombre d’abonnés et la messagerie du destinataire, la réception peut intervenir quelques minutes plus tard. Les commandes de démonstration n’inscrivent personne. Aucun rappel ne part si les commandes sont suspendues (`ORDERS_OPEN=false`) ou si toutes les dates proposées sont fermées.

## Suivi des envois

Dans Cloudflare, les journaux du Worker affichent `Weekly reminders` avec les nombres envoyés et en échec, sans les adresses des clients. Dans D1, cette requête résume les envois :

```sql
SELECT sunday,status,COUNT(*) AS nombre FROM vb_weekly_reminders GROUP BY sunday,status ORDER BY sunday DESC,status;
```

`sent` signifie accepté par Resend ; la réception effective se consulte dans Resend. `failed` indique une erreur temporaire ; jusqu’à six tentatives sont possibles, espacées d’au moins cinq minutes, le même dimanche. `review` indique une erreur permanente ou un envoi incertain trop ancien : vérifier les journaux Resend avant toute intervention. `cancelled` indique une désinscription avant l’envoi. Les limites d’envoi de votre compte Resend s’appliquent aussi aux rappels.

Les reprises utilisent le même contenu et la même clé chez Resend pour éviter les doublons ; les envois incertains ne sont plus repris après 23 heures, en deçà de sa fenêtre de 24 heures. [Documentation Resend](https://resend.com/changelog/idempotency-keys).

## Vérifications réalisées

102 tests réussis : commandes et espace équipe existants, préférence cochée/décochée, sauvegarde atomique dans D1, exclusion des tests, dimanche et changements d’heure, abonnements multiples, désinscription, concurrence, lots, erreurs et reprises. Les e-mails étaient simulés ; aucun client n’a été contacté. Le serveur Node local enregistre les préférences pour les essais mais ne lance pas d’envois planifiés : l’automatisation est assurée par le Worker Cloudflare.
