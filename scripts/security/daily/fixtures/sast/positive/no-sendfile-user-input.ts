export function download(req: any, res: any) {
  return res.sendFile(req.params.file);
}
