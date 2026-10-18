// Gemeinsamer Hook: core/frontend/src/useQuery.ts (neu laden bei Schreibvorgängen
// und Sync-Pull dieses Moduls)
import { createUseQuery } from '@fmis/core/useQuery'
import { subscribeDataChanged } from '../db/write'

export const useQuery = createUseQuery(subscribeDataChanged)
