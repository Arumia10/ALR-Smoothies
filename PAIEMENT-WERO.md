# Paiement Wero lors de la commande

La mise à jour est prête dans les fichiers ; elle n’est pas encore publiée sur le site en ligne. Aucun paiement réel ni e-mail réel n’a été effectué pendant les tests.

## Parcours du client

Après avoir vérifié ses informations, le client choisit **À la remise de la commande** ou **Maintenant avec Wero**.

Avec Wero, le récapitulatif affiche le montant exact à saisir et le bénéficiaire **2TPCM Mini-entreprise**. Sur ordinateur, le QR code fourni est affiché. Sur mobile et écran tactile, le bouton **Payer avec Wero** ouvre le lien fourni dans un nouvel onglet. Le lien reste accessible sur ordinateur comme alternative au QR code.

Après son paiement, le client revient dans l’onglet VitaminBoost, coche la vérification de sa commande puis clique sur :

**J’ai effectué le paiement — confirmer ma commande**

Le site enregistre alors la commande et sa déclaration de paiement, puis envoie l’e-mail de confirmation. L’e-mail indique que le paiement Wero a été déclaré et que l’équipe doit vérifier sa réception et le montant. Le paiement à la remise reste disponible. La version de démonstration masque les moyens de paiement réels dans le récapitulatif.

## Vérification par l’équipe

Le lien Wero fourni est un lien de paiement externe : cette mise à jour ne reçoit aucun retour automatique de Wero et ne renseigne pas automatiquement le montant dans Wero.

Dans l’espace équipe et l’export CSV, la commande porte **Wero déclaré · à vérifier**. Elle reste techniquement non payée jusqu’à la vérification de l’équipe. Après avoir retrouvé le paiement et contrôlé son montant, utiliser **Vérifier et enregistrer le paiement Wero**. Le statut devient alors **Payé** et la commande peut être marquée comme retirée.

Un clic du client ne constitue donc pas une preuve de paiement. En cas d’annulation, l’e-mail invite le client ayant déclaré un paiement à contacter l’équipe pour organiser un éventuel remboursement. Aucun remboursement automatique n’est déclenché.

Le paiement externe intervient avant l’enregistrement définitif : si le client ferme l’onglet sans confirmer, aucune commande n’est enregistrée. Si la disponibilité change ou si l’enregistrement échoue après le paiement, le site lui demande de ne pas payer une deuxième fois et de contacter `order@vitaminboostalr.com` avec sa confirmation de paiement. L’équipe doit alors retrouver le paiement et convenir de la commande ou du remboursement. Un nouvel essai avec les mêmes informations conserve la protection contre les doubles commandes et doubles e-mails.

## Installation sans terminal

1. Décompresser **VitaminBoost-paiement-Wero.zip**.
2. Dans **Cloudflare → D1 → VitaminBoostALR Database → Console**, exécuter les instructions de **2-installation-D1.sql**, une par une. Le fichier prépare les tables des rappels du dimanche si nécessaire, puis la table des déclarations Wero. Il ne supprime aucune commande et peut être exécuté à nouveau sans effacer les données. L’installer avant de publier les fichiers.
3. Dans **GitHub → Arumia10/ALR-Smoothies → Add file → Upload files**, importer le **contenu** de **1-fichiers-GitHub** à la racine du dépôt, en conservant les sous-dossiers. Valider avec **Commit changes**, puis attendre le déploiement Cloudflare réussi.
4. Recharger le site et l’espace équipe pour utiliser la nouvelle version.

Le paquet inclut les fichiers nécessaires aux rappels du dimanche de la mise à jour précédente, pour éviter des dépendances manquantes. Le fichier `wrangler.jsonc` et les secrets Cloudflare ne sont pas remplacés. Si les rappels ne sont pas encore planifiés, suivre `RAPPELS-DIMANCHE.md` ; cette planification est indépendante du paiement Wero.

Dans D1, une requête séparée permet de vérifier l’installation Wero :

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='vb_payment_declarations';
```

Le résultat doit contenir `vb_payment_declarations`.

## Vérifications

111 tests réussis, notamment : déclaration obligatoire pour le choix Wero, montant issu du calcul serveur, distinction entre déclaration et paiement vérifié, enregistrement atomique, reprises sans doublons, e-mail de confirmation adapté, annulation, rappels du dimanche, conservation du paiement à la remise et absence de paiement réel en démonstration. Le lien et le QR code fournis ont été intégrés tels quels ; aucun paiement n’a été réalisé pour tester l’application bancaire.
