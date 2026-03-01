import { Construct } from '../construct';
import { DUPLICATE_LOGICAL_ID_ERROR, EMPTY_LOGICAL_ID_ERROR } from '../errors';

describe('Construct', () => {
  describe('バリデーション', () => {
    it('空文字列のidはエラーになる', () => {
      expect(() => new Construct(undefined, '')).toThrow(EMPTY_LOGICAL_ID_ERROR);
    });

    it('空白のみのidはエラーになる', () => {
      expect(() => new Construct(undefined, '   ')).toThrow(EMPTY_LOGICAL_ID_ERROR);
    });

    it('同一スコープ内に同じidの子を追加するとエラーになる', () => {
      const parent = new Construct(undefined, 'Parent');
      new Construct(parent, 'Child');

      expect(() => new Construct(parent, 'Child')).toThrow(
        DUPLICATE_LOGICAL_ID_ERROR('Child', 'Parent')
      );
    });

    it('異なるスコープ内では同じidを使用できる', () => {
      const parent1 = new Construct(undefined, 'Parent1');
      const parent2 = new Construct(undefined, 'Parent2');

      expect(() => {
        new Construct(parent1, 'Child');
        new Construct(parent2, 'Child');
      }).not.toThrow();
    });
  });

  describe('ルートConstruct（scopeなし）', () => {
    it('idが設定される', () => {
      const root = new Construct(undefined, 'Root');

      expect(root.node.id).toBe('Root');
    });

    it('scopeがundefined', () => {
      const root = new Construct(undefined, 'Root');

      expect(root.node.scope).toBeUndefined();
    });

    it('子が空の配列', () => {
      const root = new Construct(undefined, 'Root');

      expect(root.node.children).toEqual([]);
    });

    it('パスがid自身', () => {
      const root = new Construct(undefined, 'Root');

      expect(root.node.path).toBe('Root');
    });
  });

  describe('親子関係', () => {
    it('子が親のchildrenに登録される', () => {
      const parent = new Construct(undefined, 'Parent');
      const child = new Construct(parent, 'Child');

      expect(parent.node.children).toHaveLength(1);
      expect(parent.node.children[0]).toBe(child);
    });

    it('子のscopeが親を指す', () => {
      const parent = new Construct(undefined, 'Parent');
      const child = new Construct(parent, 'Child');

      expect(child.node.scope).toBe(parent);
    });

    it('複数の子を追加できる', () => {
      const parent = new Construct(undefined, 'Parent');
      const child1 = new Construct(parent, 'Child1');
      const child2 = new Construct(parent, 'Child2');

      expect(parent.node.children).toHaveLength(2);
      expect(parent.node.children).toContain(child1);
      expect(parent.node.children).toContain(child2);
    });

    it('childrenは防御的コピーを返す', () => {
      const parent = new Construct(undefined, 'Parent');
      new Construct(parent, 'Child');

      const children = parent.node.children;
      children.push(new Construct(undefined, 'Intruder'));

      expect(parent.node.children).toHaveLength(1);
    });
  });

  describe('path', () => {
    it('ネストした構造のパスがスラッシュ区切り', () => {
      const root = new Construct(undefined, 'Root');
      const mid = new Construct(root, 'Middle');
      const leaf = new Construct(mid, 'Leaf');

      expect(leaf.node.path).toBe('Root/Middle/Leaf');
    });

    it('3階層以上でも正しくパスが組み立てられる', () => {
      const a = new Construct(undefined, 'A');
      const b = new Construct(a, 'B');
      const c = new Construct(b, 'C');
      const d = new Construct(c, 'D');

      expect(d.node.path).toBe('A/B/C/D');
    });
  });

  describe('toString', () => {
    it('pathと同じ文字列を返す', () => {
      const root = new Construct(undefined, 'Root');
      const child = new Construct(root, 'Child');

      expect(child.toString()).toBe('Root/Child');
    });
  });
});

describe('ConstructNode', () => {
  describe('metadata', () => {
    it('メタデータの追加と取得', () => {
      const construct = new Construct(undefined, 'Test');

      construct.node.addMetadata('key', 'value');

      expect(construct.node.getMetadata('key')).toBe('value');
    });

    it('存在しないキーはundefined', () => {
      const construct = new Construct(undefined, 'Test');

      expect(construct.node.getMetadata('nonexistent')).toBeUndefined();
    });

    it('オブジェクトをメタデータとして保存できる', () => {
      const construct = new Construct(undefined, 'Test');
      const data = { type: 'Product', properties: { name: 'Test' } };

      construct.node.addMetadata('resource', data);

      expect(construct.node.getMetadata('resource')).toEqual(data);
    });

    it('同一キーで上書きされる', () => {
      const construct = new Construct(undefined, 'Test');

      construct.node.addMetadata('key', 'first');
      construct.node.addMetadata('key', 'second');

      expect(construct.node.getMetadata('key')).toBe('second');
    });
  });

  describe('findAll', () => {
    it('自身のみのツリーでは自身だけ返す', () => {
      const root = new Construct(undefined, 'Root');

      const all = root.node.findAll();

      expect(all).toHaveLength(1);
      expect(all[0]).toBe(root);
    });

    it('子を含むすべてのConstructを返す', () => {
      const root = new Construct(undefined, 'Root');
      const child1 = new Construct(root, 'Child1');
      const child2 = new Construct(root, 'Child2');

      const all = root.node.findAll();

      expect(all).toHaveLength(3);
      expect(all).toContain(root);
      expect(all).toContain(child1);
      expect(all).toContain(child2);
    });

    it('孫まで再帰的に返す', () => {
      const root = new Construct(undefined, 'Root');
      const child = new Construct(root, 'Child');
      const grandchild = new Construct(child, 'Grandchild');

      const all = root.node.findAll();

      expect(all).toHaveLength(3);
      expect(all).toContain(root);
      expect(all).toContain(child);
      expect(all).toContain(grandchild);
    });

    it('深いツリーでもすべてのノードを返す', () => {
      const root = new Construct(undefined, 'Root');
      const a = new Construct(root, 'A');
      const b = new Construct(root, 'B');
      const a1 = new Construct(a, 'A1');
      const a2 = new Construct(a, 'A2');
      const b1 = new Construct(b, 'B1');

      const all = root.node.findAll();

      expect(all).toHaveLength(6);
      expect(all).toContain(a1);
      expect(all).toContain(a2);
      expect(all).toContain(b1);
    });
  });
});
