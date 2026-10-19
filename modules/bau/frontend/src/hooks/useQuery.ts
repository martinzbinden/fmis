// Gemeinsamer Hook: core/frontend/src/useQuery.ts
import { createUseQuery } from '@fmis/core/useQuery'
import { subscribeDataChanged } from '../db/write'

export const useQuery = createUseQuery(subscribeDataChanged)
