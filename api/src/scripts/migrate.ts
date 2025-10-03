import { db } from '../db/client';
import { sql } from 'drizzle-orm';

console.log('Creating database tables...');

// Créer la table companies
await db.run(sql`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    size TEXT,
    products TEXT,
    processes TEXT,
    challenges TEXT,
    objectives TEXT,
    technologies TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Créer la table folders
await db.run(sql`
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    company_id TEXT,
    matrix_config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  )
`);

// Créer la table use_cases
await db.run(sql`
  CREATE TABLE IF NOT EXISTS use_cases (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    company_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    process TEXT,
    technology TEXT,
    deadline TEXT,
    contact TEXT,
    benefits TEXT,
    metrics TEXT,
    risks TEXT,
    next_steps TEXT,
    sources TEXT,
    related_data TEXT,
    value_scores TEXT,
    complexity_scores TEXT,
    total_value_score INTEGER,
    total_complexity_score INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  )
`);

console.log('Database tables created successfully!');
