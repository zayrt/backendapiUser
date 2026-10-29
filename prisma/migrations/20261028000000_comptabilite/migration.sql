CREATE TABLE "imports_comptables" (
    "id" SERIAL NOT NULL,
    "nom_fichier" VARCHAR(255) NOT NULL,
    "hash_fichier" CHAR(64) NOT NULL,
    "lignes_importees" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imports_comptables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ecritures" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "journal" VARCHAR(10) NOT NULL,
    "piece" VARCHAR(30) NOT NULL,
    "compte" VARCHAR(20) NOT NULL,
    "libelle" VARCHAR(255) NOT NULL,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "code_lettrage" VARCHAR(10),
    "ligne_hash" CHAR(64) NOT NULL,
    "import_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecritures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ecritures_montants_positifs" CHECK ("debit" >= 0 AND "credit" >= 0),
    CONSTRAINT "ecritures_un_seul_sens" CHECK (("debit" = 0) <> ("credit" = 0)),
    CONSTRAINT "ecritures_lettrage_411_512" CHECK ("code_lettrage" IS NULL OR "compte" LIKE '411%' OR "compte" LIKE '512%')
);

CREATE UNIQUE INDEX "imports_comptables_hash_fichier_key" ON "imports_comptables"("hash_fichier");

CREATE UNIQUE INDEX "ecritures_ligne_hash_key" ON "ecritures"("ligne_hash");

CREATE INDEX "ecritures_compte_code_lettrage_idx" ON "ecritures"("compte", "code_lettrage");

CREATE INDEX "ecritures_journal_piece_idx" ON "ecritures"("journal", "piece");

ALTER TABLE "imports_comptables" ADD CONSTRAINT "imports_comptables_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ecritures" ADD CONSTRAINT "ecritures_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports_comptables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
