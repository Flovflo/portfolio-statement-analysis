# Analyse Trade Republic locale

Outil statique qui analyse un relevé de compte Trade Republic directement dans le navigateur.

## Utilisation locale

```bash
npm install
npm run vendor:pdfjs
python3 -m http.server 8765
```

Ouvre ensuite `http://127.0.0.1:8765/index.html`, importe le PDF, puis l’analyse se calcule côté navigateur.

## Hébergement GitHub Pages

Publie les fichiers du dépôt, en incluant `vendor/pdfjs/`. Aucun backend n’est nécessaire. Le PDF choisi par l’utilisateur reste local au navigateur et n’est pas envoyé à un serveur.

## Validation

```bash
npm test
STATEMENT_PDF="/path/to/account-statement.pdf" npm test
npm run check
```

Le second test lance aussi l’extraction PDF.js sur un relevé local, sans publier ni copier le PDF dans le dépôt.
