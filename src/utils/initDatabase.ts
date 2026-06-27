import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

export async function initDatabase() {
  const dbName = 'base.db';
  const dbPath = FileSystem.documentDirectory + dbName;

  const fileInfo = await FileSystem.getInfoAsync(dbPath);

  if (!fileInfo.exists) {
    const asset = Asset.fromModule(require('../../assets/base.db'));
    await asset.downloadAsync();

    await FileSystem.copyAsync({
      from: asset.localUri!,
      to: dbPath,
    });
  }

  const db = await SQLite.openDatabaseAsync(dbPath);
  return db;
}