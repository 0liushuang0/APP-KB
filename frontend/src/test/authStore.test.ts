import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../store/authStore'

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear()
    // 重置 store
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      appMode: 'single',
    })
  })

  it('初始状态应为未认证', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('setAuth 应设置用户信息和认证状态', () => {
    const { setAuth } = useAuthStore.getState()

    setAuth({
      user: {
        id: '1',
        username: 'admin',
        nickname: '管理员',
        roles: [{ code: 'admin', name: '管理员' }],
      },
    })

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.username).toBe('admin')
    expect(state.user?.nickname).toBe('管理员')
  })

  it('clearAuth 应清除所有状态', () => {
    const { setAuth, clearAuth } = useAuthStore.getState()

    setAuth({
      user: {
        id: '1',
        username: 'admin',
        roles: [{ code: 'admin', name: '管理员' }],
      },
    })

    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    clearAuth()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('hasRole 应正确判断角色', () => {
    useAuthStore.setState({
      user: {
        id: '1',
        username: 'admin',
        roles: [
          { code: 'admin', name: '管理员' },
          { code: 'editor', name: '编辑' },
        ],
      },
      isAuthenticated: true,
    })

    const { hasRole, hasAnyRole } = useAuthStore.getState()
    expect(hasRole('admin')).toBe(true)
    expect(hasRole('viewer')).toBe(false)
    expect(hasAnyRole(['admin', 'viewer'])).toBe(true)
    expect(hasAnyRole(['viewer', 'editor'])).toBe(true)
    expect(hasAnyRole(['viewer'])).toBe(false)
  })

  it('setAppMode 应设置应用模式', () => {
    const { setAppMode } = useAuthStore.getState()

    setAppMode('team')

    expect(useAuthStore.getState().appMode).toBe('team')
  })
})
