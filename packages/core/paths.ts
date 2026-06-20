// Replica layout (Specification §5.1). One Realm = one directory = one key.
import os from 'node:os';
import path from 'node:path';

export interface ReplicaLayout {
  root: string;
  realmToml: string;
  dbBlob: string; // memoring.db (at-rest AEAD blob; never an on-disk SQLite file)
  objectsDir: string;
  indexesDir: string;
  connectorsDir: string;
  policiesDir: string;
  logsDir: string;
  keysDir: string;
  keyBundle: string;
}

export function defaultReplicaRoot(): string {
  return process.env.MEMORING_HOME ?? path.join(os.homedir(), '.memoring');
}

export function replicaLayout(root = defaultReplicaRoot()): ReplicaLayout {
  return {
    root,
    realmToml: path.join(root, 'realm.toml'),
    dbBlob: path.join(root, 'memoring.db'),
    objectsDir: path.join(root, 'objects'),
    indexesDir: path.join(root, 'indexes'),
    connectorsDir: path.join(root, 'connectors'),
    policiesDir: path.join(root, 'policies'),
    logsDir: path.join(root, 'logs'),
    keysDir: path.join(root, 'keys'),
    keyBundle: path.join(root, 'keys', 'keybundle.json'),
  };
}

export const REPLICA_SUBDIRS: (keyof ReplicaLayout)[] = [
  'objectsDir',
  'indexesDir',
  'connectorsDir',
  'policiesDir',
  'logsDir',
  'keysDir',
];
