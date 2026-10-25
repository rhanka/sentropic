/** Auxiliary routes stay unselected in the Radar transport composition. */

  it('refuses upload and template routes when the host wired no ports', async () => {
    const app = makeApp(false);
    const id = await seededId(app);
    const upload = await app.handle(
      req('POST', '/uploads', { artifactId: id, mimeType: 'text/plain' }, OWNER),
    );
    expect(upload.status).toBe(400);
    const template = await app.handle(req('GET', '/templates/static-html', undefined, OWNER));
    expect(template.status).toBe(400);
  });
});
