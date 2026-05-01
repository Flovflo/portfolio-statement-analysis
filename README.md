# Analyse Trade Republic locale

Outil statique qui analyse un relevé PDF ou un export CSV Trade Republic directement dans le navigateur.

## Utilisation locale

```bash
npm install
npm run vendor:pdfjs
python3 -m http.server 8765
```

Ouvre ensuite `http://127.0.0.1:8765/index.html`, importe le PDF ou `Transaction export.csv`, puis l’analyse se calcule côté navigateur.

## Contrat de données

Le rapport affiche uniquement:

- les champs lus dans le PDF: période, soldes déclarés, libellés, dates, ISIN, quantités quand elles existent;
- les calculs vérifiables: montant de transaction par différence de soldes, totaux mensuels, catégories de flux, coût net par ISIN;
- les champs lus dans le CSV: les 23 colonnes de l’export (`datetime`, `date`, `account_type`, `category`, `type`, `asset_class`, `name`, `symbol`, `shares`, `price`, `amount`, `fee`, `tax`, `currency`, `original_amount`, `original_currency`, `fx_rate`, `description`, `transaction_id`, `counterparty_name`, `counterparty_iban`, `payment_reference`, `mcc_code`);
- les calculs trading vérifiables depuis le CSV: ordres BUY/SELL, coût ouvert FIFO, P/L réalisé FIFO, frais/taxes, classes d’actifs, activité mensuelle, revenus d’instruments et couverture de colonnes;
- les limites explicites: valeur de marché, performance latente, allocation réelle actuelle, fiscalité complète et score de risque ne sont pas calculés car absents du relevé.

Les champs sensibles du CSV comme `counterparty_iban`, `counterparty_name` et `transaction_id` sont parsés pour l’audit/couverture, mais ne sont pas affichés bruts dans les vues trading.

## Hébergement GitHub Pages

Publie les fichiers du dépôt, en incluant `vendor/pdfjs/`. Aucun backend n’est nécessaire. Le PDF ou CSV choisi par l’utilisateur reste local au navigateur et n’est pas envoyé à un serveur.

## Validation

```bash
npm test
STATEMENT_PDF="/path/to/account-statement.pdf" npm test
TRANSACTION_CSV="/path/to/Transaction export.csv" npm test
npm run check
```

Les tests optionnels lisent des fichiers locaux sans les publier ni les copier dans le dépôt.
