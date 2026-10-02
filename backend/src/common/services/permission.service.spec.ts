import { ConfigService } from '@nestjs/config';
import { PermissionService, CurrentUser, PermissionSubject } from './permission.service';

const makeConfig = (mode: 'single' | 'team' = 'team') =>
  ({ get: () => mode }) as unknown as ConfigService;

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  userId: 'u1',
  username: 'testuser',
  roles: [],
  isSystemAdmin: false,
  ...over,
});

const subject = (over: Partial<PermissionSubject> = {}): PermissionSubject => ({
  visibility: 'public',
  ...over,
});

describe('PermissionService', () => {
  // ── canAccess ──
  describe('canAccess', () => {
    it('单机模式下任何人可访问任何资源', () => {
      const svc = new PermissionService(makeConfig('single'));
      expect(svc.canAccess(undefined, subject({ visibility: 'private' }))).toBe(true);
    });

    it('未登录用户只能访问 public', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canAccess(undefined, subject({ visibility: 'public' }))).toBe(true);
      expect(svc.canAccess(undefined, subject({ visibility: 'private' }))).toBe(false);
      expect(svc.canAccess(undefined, subject({ visibility: 'department' }))).toBe(false);
    });

    it('系统管理员可访问所有资源', () => {
      const svc = new PermissionService(makeConfig('team'));
      const admin = user({ isSystemAdmin: true });
      expect(svc.canAccess(admin, subject({ visibility: 'private' }))).toBe(true);
      expect(svc.canAccess(admin, subject({ visibility: 'department' }))).toBe(true);
    });

    it('public 对所有登录用户可见', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canAccess(user(), subject({ visibility: 'public' }))).toBe(true);
    });

    it('private 仅对 owner 可见', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'private', uploaderId: 'u1' });
      expect(svc.canAccess(user({ userId: 'u1' }), s)).toBe(true);
      expect(svc.canAccess(user({ userId: 'u2' }), s)).toBe(false);
    });

    it('department 仅同部门可见', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'department', departmentId: 'd1' });
      expect(svc.canAccess(user({ departmentId: 'd1' }), s)).toBe(true);
      expect(svc.canAccess(user({ departmentId: 'd2' }), s)).toBe(false);
      expect(svc.canAccess(user({ departmentId: undefined }), s)).toBe(false);
    });

    it('group 按交集判断', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'group', groupIds: ['g1', 'g2'] });
      expect(svc.canAccess(user({ groupIds: ['g2', 'g3'] }), s)).toBe(true);
      expect(svc.canAccess(user({ groupIds: ['g3'] }), s)).toBe(false);
    });

    it('group 无 groupIds 时不可见', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'group', groupIds: ['g1'] });
      expect(svc.canAccess(user({ groupIds: undefined }), s)).toBe(false);
    });

    it('role 按交集判断', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'role', roleCodes: ['admin', 'sales'] });
      expect(svc.canAccess(user({ roles: ['sales'] }), s)).toBe(true);
      expect(svc.canAccess(user({ roles: ['engineer'] }), s)).toBe(false);
    });

    it('role 无 roleCodes 时不可见', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ visibility: 'role', roleCodes: ['admin'] });
      expect(svc.canAccess(user({ roles: [] }), s)).toBe(false);
    });
  });

  // ── canManage ──
  describe('canManage', () => {
    it('单机模式下任何人可管理', () => {
      const svc = new PermissionService(makeConfig('single'));
      expect(svc.canManage(undefined, subject())).toBe(true);
    });

    it('未登录不能管理', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canManage(undefined, subject())).toBe(false);
    });

    it('系统管理员可管理所有', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canManage(user({ isSystemAdmin: true }), subject())).toBe(true);
    });

    it('owner 可管理', () => {
      const svc = new PermissionService(makeConfig('team'));
      const s = subject({ uploaderId: 'u1' });
      expect(svc.canManage(user({ userId: 'u1' }), s)).toBe(true);
      expect(svc.canManage(user({ userId: 'u2' }), s)).toBe(false);
    });
  });

  // ── canApprove ──
  describe('canApprove', () => {
    it('单机模式下任何人可审核', () => {
      const svc = new PermissionService(makeConfig('single'));
      expect(svc.canApprove(undefined)).toBe(true);
    });

    it('未登录不能审核', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canApprove(undefined)).toBe(false);
    });

    it('系统管理员可审核', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canApprove(user({ isSystemAdmin: true }))).toBe(true);
    });

    it('admin 角色可审核', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canApprove(user({ roles: ['admin'] }))).toBe(true);
    });

    it('approver 角色可审核', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canApprove(user({ roles: ['approver'] }))).toBe(true);
    });

    it('普通角色不能审核', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.canApprove(user({ roles: ['viewer'] }))).toBe(false);
    });
  });

  // ── skipApproval ──
  describe('skipApproval', () => {
    it('单机模式跳过审批', () => {
      const svc = new PermissionService(makeConfig('single'));
      expect(svc.skipApproval()).toBe(true);
    });

    it('团队模式不跳过审批', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.skipApproval()).toBe(false);
    });
  });

  // ── isSingleMode ──
  describe('isSingleMode', () => {
    it('single 模式返回 true', () => {
      const svc = new PermissionService(makeConfig('single'));
      expect(svc.isSingleMode()).toBe(true);
    });

    it('team 模式返回 false', () => {
      const svc = new PermissionService(makeConfig('team'));
      expect(svc.isSingleMode()).toBe(false);
    });
  });
});
