# Luxury Bharat

A premium ecommerce platform with a storefront, admin dashboard, product and inventory management, orders, and customer support.

## Requirements

- Node.js 22.13 or newer
- npm

## Run locally

From the repository root:

```powershell
npm install --prefix luxury-bharat
npm run start
```

Open [http://localhost:3000](http://localhost:3000).

To configure email, payments, or other environment-specific settings, copy the example file and edit it:

```powershell
Copy-Item luxury-bharat\.env.example luxury-bharat\.env
```

Keep `.env` and your local `data` directory private; they are excluded from Git. Never commit API keys, passwords, or other secrets.

## Useful commands

```powershell
npm run dev       # Start in development mode
npm test          # Run the end-to-end tests
npm run seed:demo # Add demo catalogue data
```

The app stores its SQLite database and uploaded files in `luxury-bharat/data` by default. Back up this directory if you need to preserve local store data.

See [the full project documentation](./luxury-bharat/README.md) for account setup, configuration, deployment, and security details.
