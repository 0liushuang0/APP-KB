import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

type SetPageActions = (node: ReactNode | null) => void

export const PageActionsContext = createContext<SetPageActions>(() => {})

export const usePageActions = () => useContext(PageActionsContext)
