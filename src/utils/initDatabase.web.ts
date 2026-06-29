export async function initDatabase() {
  console.log('SQLite desativado no WEB');

  return {
    getAllAsync: async () => [],
    runAsync: async () => {},
  };
}