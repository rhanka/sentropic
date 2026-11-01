export function download(res: any) {
  return res.sendFile('assets/report.pdf');
}
