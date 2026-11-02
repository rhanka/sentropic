export function find(db: any, id: string) {
  return db.query('SELECT * FROM users WHERE id = ?', [id]);
}
