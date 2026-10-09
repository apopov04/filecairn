// Builds tests/fixtures/sample.pdf: 5 numbered pages, one landscape, one already rotated.
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import fs from "fs";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
const colors = [rgb(.06, .33, .41), rgb(.85, .25, .25), rgb(.2, .6, .3), rgb(.9, .6, .1), rgb(.4, .3, .7)];
for (let i = 0; i < 5; i++) {
  const page = doc.addPage(i === 2 ? [842, 595] : [595, 842]);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 40, y: 40, width: width - 80, height: height - 80, borderColor: colors[i], borderWidth: 6 });
  page.drawText(String(i + 1), { x: width / 2 - 60, y: height / 2 - 60, size: 180, font, color: colors[i] });
  page.drawText(`Page ${i + 1}`, { x: 60, y: height - 100, size: 28, font });
  if (i === 4) page.setRotation(degrees(90));
}
doc.setAuthor("Secret Author"); doc.setProducer("Fixture");
fs.mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./fixtures/sample.pdf", import.meta.url), await doc.save());
console.log("wrote tests/fixtures/sample.pdf");
