import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Entity, PrimaryColumn, Column } from 'typeorm';
import { PermissionQueryService } from './permission-query.service';
import { CurrentUser } from './permission.service';

/** 用一张最小实体验证可见性 SQL —— 跑真库比断言 SQL 字符串可靠得多 */
@Entity('perm_fixture')
class Fixture {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'varchar' })
  visibility: string;

  @Column({ type: 'varchar', nullable: true })
  ownerId: string;

  @Column({ type: 'varchar', nullable: true })
  departmentId: string;

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];
}

const config = (mode: 'single' | 'team') =>
  ({ get: () => mode }) as unknown as ConfigService;

describe('PermissionQueryService', () => {
  let ds: DataSource;
  let repo: Repository<Fixture>;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Fixture],
      synchronize: true,
    });
    await ds.initialize();
    repo = ds.getRepository(Fixture);

    await repo.save([
      { id: 'pub', visibility: 'public' },
      { id: 'priv-a', visibility: 'private', ownerId: 'userA' },
      { id: 'priv-b', visibility: 'private', ownerId: 'userB' },
      { id: 'dept-1', visibility: 'department', departmentId: 'd1' },
      { id: 'dept-2', visibility: 'department', departmentId: 'd2' },
      { id: 'grp-x', visibility: 'group', groupIds: ['g1', 'g2'] },
      { id: 'grp-y', visibility: 'group', groupIds: ['g9'] },
      // 前缀陷阱：'g1' 不应命中 'g10'
      { id: 'grp-prefix', visibility: 'group', groupIds: ['g10'] },
      { id: 'role-sales', visibility: 'role', roleCodes: ['sales', 'admin'] },
      { id: 'role-eng', visibility: 'role', roleCodes: ['engineer'] },
    ]);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  const idsFor = async (user: CurrentUser | undefined, mode: 'single' | 'team' = 'team') => {
    const svc = new PermissionQueryService(config(mode));
    const qb = repo.createQueryBuilder('f');
    svc.apply(qb, 'f', user);
    const rows = await qb.getMany();
    return rows.map((r) => r.id).sort();
  };

  const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
    userId: 'userA',
    username: 'a',
    roles: [],
    isSystemAdmin: false,
    ...over,
  });

  it('单机模式不做任何过滤', async () => {
    expect((await idsFor(user(), 'single')).length).toBe(10);
  });

  it('系统管理员看全部', async () => {
    expect((await idsFor(user({ isSystemAdmin: true }))).length).toBe(10);
  });

  it('未登录只看 public', async () => {
    expect(await idsFor(undefined)).toEqual(['pub']);
  });

  it('private 只对归属人可见', async () => {
    const ids = await idsFor(user({ userId: 'userA' }));
    expect(ids).toContain('priv-a');
    expect(ids).not.toContain('priv-b');
  });

  it('department 只对同部门可见', async () => {
    const ids = await idsFor(user({ departmentId: 'd1' }));
    expect(ids).toContain('dept-1');
    expect(ids).not.toContain('dept-2');
  });

  it('无部门的用户看不到任何 department 记录', async () => {
    const ids = await idsFor(user({ departmentId: undefined }));
    expect(ids).not.toContain('dept-1');
    expect(ids).not.toContain('dept-2');
  });

  it('group 按交集可见', async () => {
    const ids = await idsFor(user({ groupIds: ['g2'] }));
    expect(ids).toContain('grp-x');
    expect(ids).not.toContain('grp-y');
  });

  it('group 匹配不能被前缀误伤：g1 不应命中 g10', async () => {
    // simple-array 存成 'g10'，若不补分隔符做 LIKE '%g1%' 就会错误命中
    const ids = await idsFor(user({ groupIds: ['g1'] }));
    expect(ids).toContain('grp-x'); // 确实含 g1
    expect(ids).not.toContain('grp-prefix'); // 只含 g10，不该命中
  });

  it('role 按交集可见', async () => {
    const ids = await idsFor(user({ roles: ['sales'] }));
    expect(ids).toContain('role-sales');
    expect(ids).not.toContain('role-eng');
  });

  it('public 对所有人可见', async () => {
    expect(await idsFor(user())).toContain('pub');
  });

  it('多维度叠加：同时拥有部门与角色时都能看到', async () => {
    const ids = await idsFor(user({ departmentId: 'd2', roles: ['engineer'] }));
    expect(ids).toEqual(expect.arrayContaining(['pub', 'dept-2', 'role-eng']));
    expect(ids).not.toContain('dept-1');
    expect(ids).not.toContain('role-sales');
  });

  it('过滤后仍可正确分页 —— 这正是下沉 SQL 的目的', async () => {
    const svc = new PermissionQueryService(config('team'));
    const qb = repo.createQueryBuilder('f');
    svc.apply(qb, 'f', user({ userId: 'userA' }));
    const [list, total] = await qb.orderBy('f.id', 'ASC').skip(0).take(1).getManyAndCount();

    // total 是过滤后的总数，list 精确一条 —— 旧的 JS 过滤做不到这点
    expect(list).toHaveLength(1);
    expect(total).toBe(2); // pub + priv-a
  });
});
