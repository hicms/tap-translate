import type { GistFiles } from '../../lib/backup/crypto';

/** In-memory HTTP peer: no calls to GitHub and no production credentials. */
export class MockGitHub {
  account = { id: 7, login: 'tester' };
  gists = new Map<string, Record<string, unknown>>();
  calls: { url: string; init?: RequestInit }[] = [];
  loseCreateResponse = false;
  nextStatus = 0;
  scopes: string | null = 'gist';
  private serial = 0;

  add(files: GistFiles, description = 'fixture'): string {
    const id = (++this.serial).toString(16).padStart(32, '0');
    const revision = this.serial.toString(16).padStart(40, '0');
    this.gists.set(id, {
      id, owner: this.account, public: false, description, created_at: new Date().toISOString(),
      history: [{ version: revision }],
      files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, {
        ...file, size: new TextEncoder().encode(file.content).length, truncated: false,
        raw_url: `https://gist.githubusercontent.com/${this.account.login}/${id}/raw/${revision}/${name}`,
      }])),
    });
    return id;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    this.calls.push({ url: url.href, init });
    if (this.nextStatus) { const status = this.nextStatus; this.nextStatus = 0; return Response.json({ message: 'secret echo must be ignored' }, { status }); }
    if (url.pathname === '/user') return Response.json(this.account, { headers: this.scopes === null ? {} : { 'x-oauth-scopes': this.scopes } });
    if (url.hostname === 'gist.githubusercontent.com') {
      const parts = url.pathname.split('/');
      const gist = this.gists.get(parts[2]!);
      const file = (gist?.files as Record<string, { content: string }> | undefined)?.[parts.at(-1)!];
      return new Response(file?.content ?? '', { status: file ? 200 : 404 });
    }
    if (url.pathname === '/gists' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = this.add(body.files, body.description);
      if (this.loseCreateResponse) { this.loseCreateResponse = false; throw new TypeError('Response lost'); }
      return Response.json(this.gists.get(id), { status: 201 });
    }
    if (url.pathname === '/gists') {
      const all = [...this.gists.values()].reverse();
      const page = Number(url.searchParams.get('page') ?? 1);
      const items = all.slice((page - 1) * 20, page * 20).map(gist => ({ ...gist,
        files: Object.fromEntries(Object.entries(gist.files as Record<string, Record<string, unknown>>)
          .map(([name, file]) => [name, Object.fromEntries(Object.entries(file).filter(([key]) => key !== 'content'))])),
      }));
      return Response.json(items, { headers: all.length > page * 20
        ? { link: '<https://api.github.com/gists?page=2>; rel="next"' } : {} });
    }
    const id = url.pathname.split('/')[2]!;
    const gist = this.gists.get(id);
    return Response.json(gist ?? {}, { status: gist ? 200 : 404 });
  };
}
