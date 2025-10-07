const Database = require('better-sqlite3');
const db = new Database('/data/app.db');

const companyId = '5b790ca8-ba18-465f-95e6-a318722ef43a';

console.log('=== DEBUGGING FOREIGN KEY CONSTRAINTS ===');
console.log('Company ID:', companyId);

// Check folders
const folders = db.prepare('SELECT id, name FROM folders WHERE company_id = ?').all(companyId);
console.log('Folders referencing this company:', folders.length);
folders.forEach(f => console.log('  -', f.id, f.name));

// Check use cases
const useCases = db.prepare('SELECT id, name FROM use_cases WHERE company_id = ?').all(companyId);
console.log('Use cases referencing this company:', useCases.length);
useCases.forEach(uc => console.log('  -', uc.id, uc.name));

// Check if company exists
const company = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(companyId);
console.log('Company exists:', !!company);
if (company) {
  console.log('  -', company.id, company.name);
}

// Try to delete step by step
console.log('\n=== TRYING STEP-BY-STEP DELETION ===');

try {
  console.log('1. Deleting use cases...');
  const deleteUseCases = db.prepare('DELETE FROM use_cases WHERE company_id = ?');
  const useCasesResult = deleteUseCases.run(companyId);
  console.log('   Deleted use cases:', useCasesResult.changes);
} catch (error) {
  console.log('   Error deleting use cases:', error.message);
}

try {
  console.log('2. Deleting folders...');
  const deleteFolders = db.prepare('DELETE FROM folders WHERE company_id = ?');
  const foldersResult = deleteFolders.run(companyId);
  console.log('   Deleted folders:', foldersResult.changes);
} catch (error) {
  console.log('   Error deleting folders:', error.message);
}

try {
  console.log('3. Deleting company...');
  const deleteCompany = db.prepare('DELETE FROM companies WHERE id = ?');
  const companyResult = deleteCompany.run(companyId);
  console.log('   Deleted company:', companyResult.changes);
} catch (error) {
  console.log('   Error deleting company:', error.message);
}

db.close();
