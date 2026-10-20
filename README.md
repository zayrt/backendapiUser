# Backend API

API REST Node.js avec Express, TypeScript, Prisma ORM 7 et PostgreSQL. Les utilisateurs sont persistés dans la base.

## Installation

```sh
cd backend-api
npm install
```

Configure `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_DB` dans `.env`. Si le fichier n'existe pas, `.env.example` contient des valeurs de développement à adapter; conserve les valeurs locales déjà présentes plutôt que d'écraser le fichier.

Le backend utilise Prisma ORM 7 et son adaptateur PostgreSQL `@prisma/adapter-pg`. Le schéma est défini dans `prisma/schema.prisma` et la connexion dans `prisma.config.ts`.

## PostgreSQL et migrations

Depuis `backend-api/`, démarre PostgreSQL :

```sh
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run db:seed
```

Le conteneur expose PostgreSQL uniquement sur `localhost:5432` et stocke ses données dans le volume nommé `postgres_data`. `docker compose stop db`, puis `docker compose up -d db`, arrête et redémarre le conteneur sans supprimer les données. N'utilise pas `docker compose down -v` si tu veux conserver ce volume.

La migration initiale crée `User` avec un ID auto-incrémenté, un email unique et les timestamps `createdAt`/`updatedAt`. `npm run db:migrate` applique les migrations en développement; `npm run db:deploy` les applique en production. Si Prisma demande de réinitialiser une base existante, annule la commande et vérifie son état avant toute opération destructive.

Le seed ajoute les 103 utilisateurs mémoire initiaux avec leurs IDs, ignore les doublons et recale la séquence PostgreSQL. Il peut être relancé sans dupliquer les lignes.

## Démarrage

```sh
npm run dev
```

Le serveur utilise `PORT=3000` par défaut. Pour compiler et démarrer la version de production :

```sh
npm run build
npm start
```

Les scripts `db:generate`, `db:deploy` et `db:studio` permettent respectivement de générer le client, d’appliquer les migrations en production et d’ouvrir Prisma Studio.

## Routes

| Méthode | Route | Résultat |
| --- | --- | --- |
| GET | `/api/health` | État du serveur |
| GET | `/api/users` | Liste des utilisateurs |
| GET | `/api/users/:id` | Un utilisateur |
| GET | `/api/stats/users-growth?days=7` | Effectifs cumulés par jour, fuseau `Europe/Paris` |
| GET | `/api/stats/users-summary?days=7` | Total actuel, utilisateurs modifiés et supprimés sur la période |
| POST | `/api/users` | Création, réponse `201` |
| PUT | `/api/users/:id` | Remplacement d’un utilisateur |
| DELETE | `/api/users/:id` | Suppression, réponse `204` |

Les réponses contenant des données utilisent `{ "data": ... }`. Les erreurs utilisent `{ "error": { "message": "..." } }`.
Pour `POST` et `PUT`, `name` et `email` sont requis. Les adresses e-mail doivent être valides et uniques.

La courbe d'évolution compte, pour chaque fin de journée locale, les créations, modifications et suppressions distinctes. Pour le total historique, elle part du total actuel et le corrige avec les créations/suppressions dont la date est connue. Les suppressions antérieures à l'audit n'étant pas enregistrées, les totaux des jours antérieurs à sa mise en place ne sont pas l'historique exact des effectifs.

Les événements CREATE/UPDATE/DELETE sont conservés dans `UserAuditLog`, sans clé étrangère vers `User`, et ne contiennent aucune valeur utilisateur. La collecte complète des trois actions commence à l'application de la migration `20261020120000_user_audit_create` (20 octobre 2026); les événements antérieurs ne sont pas reconstitués. Pour les utilisateurs encore présents, `createdAt` sert de repli lorsqu'aucun audit CREATE n'existe.

## Exemples curl

```sh
curl http://localhost:3000/api/health
curl http://localhost:3000/api/users
curl http://localhost:3000/api/users/1
curl 'http://localhost:3000/api/stats/users-growth?days=7'
curl 'http://localhost:3000/api/stats/users-summary?days=7'

curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Dana Petit","email":"dana@example.com"}'

curl -X PUT http://localhost:3000/api/users/1 \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice Martin","email":"alice.martin@example.com"}'

# Ces requêtes doivent renvoyer 409 (email déjà utilisé) et 404 (ID absent)
curl -i -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Autre Alice","email":"alice@example.com"}'
curl -i http://localhost:3000/api/users/999999

# Crée d'abord un utilisateur de test, puis renseigne l'ID renvoyé par le POST.
TEST_USER_ID=ID_RETOURNE_PAR_LE_POST
curl -i -X DELETE "http://localhost:3000/api/users/${TEST_USER_ID}"
```

Après un `POST` ou `PUT`, redémarre seulement l'API avec `Ctrl+C` puis `npm run dev` : les données restent dans PostgreSQL. Pour vérifier la persistance du conteneur, utilise `docker compose stop db` puis `docker compose up -d db` et relance `GET /api/users`.