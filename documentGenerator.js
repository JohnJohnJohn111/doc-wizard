const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, WidthType, Table, TableRow, TableCell,
  ShadingType
} = require('docx');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'generated');

function heading1(text) {
  return new Paragraph({
    spacing: { before: 400, after: 160 },
    children: [new TextRun({ text, bold: true, size: 28, font: 'Calibri', color: '1B3A4B' })]
  });
}

function heading2(text) {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: 'Calibri', color: '2E5C7A' })]
  });
}

function field(label, value) {
  if (!value || (typeof value === 'string' && !value.trim())) return [];
  return [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: label + ': ', bold: true, font: 'Calibri', size: 22 }),
        new TextRun({ text: value, font: 'Calibri', size: 22 })
      ]
    })
  ];
}

function rule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
    spacing: { before: 240, after: 240 },
    children: []
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { before: 60, after: 60 }, children: [] });
}

function buildShelfCompany(answers) {
  const {
    entity_name, address, accounting_year, business,
    share_capital, shareholders, email, clauses,
    board_members, deputy_board_members, managing_director,
    authorized_signatory, auditor
  } = answers;

  const children = [];

  // Title block
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: 'CMSW', bold: true, size: 48, font: 'Calibri', color: '1B3A4B' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: 'Shelf Company Generator', size: 28, font: 'Calibri', color: '2E5C7A' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 480 },
      children: [new TextRun({ text: 'Company Formation Data Sheet', size: 22, font: 'Calibri', color: '888888', italics: true })]
    }),
    rule()
  );

  // Section 1: Company Details
  children.push(heading1('1. Company Details'));
  children.push(...field('Name of new entity', entity_name));
  children.push(...field('Registered address', address));
  children.push(...field('Accounting year', accounting_year));
  children.push(...field('Business of the company', business));
  children.push(...field('Share capital', share_capital));
  children.push(...field('Shareholder(s)', shareholders));
  children.push(...field('Company e-mail address', email || 'Not provided'));

  children.push(rule());

  // Section 2: Applicable Provisions
  children.push(heading1('2. Applicable Provisions'));
  const allClauses = [
    'Pre-emption clause',
    'Consent clause',
    'Right of first refusal clause',
    'Issue original share certificates'
  ];
  const selectedClauses = Array.isArray(clauses) ? clauses : [];
  allClauses.forEach(clause => {
    const checked = selectedClauses.includes(clause);
    children.push(
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          new TextRun({ text: (checked ? '☑' : '☐') + '  ', font: 'Calibri', size: 22 }),
          new TextRun({ text: clause, font: 'Calibri', size: 22, bold: checked })
        ]
      })
    );
  });

  children.push(rule());

  // Section 3: Board Members
  children.push(heading1('3. Board Members'));
  if (Array.isArray(board_members) && board_members.length > 0) {
    board_members.forEach((person, i) => {
      children.push(heading2(`Board Member ${i + 1}${person.Chairman === 'Yes' ? ' (Chairman)' : ''}`));
      children.push(...field('Full name', person['Full name']));
      children.push(...field('Date of birth / Social security number', person['Date of birth / Social security number']));
      children.push(...field('Address', person['Address']));
      children.push(...field('Nationality', person['Nationality']));
      children.push(emptyLine());
    });
  } else {
    children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: 'Not provided', font: 'Calibri', size: 22, italics: true, color: '888888' })] }));
  }

  children.push(rule());

  // Section 4: Deputy Board Members
  children.push(heading1('4. Deputy Board Members'));
  if (Array.isArray(deputy_board_members) && deputy_board_members.length > 0) {
    deputy_board_members.forEach((person, i) => {
      children.push(heading2(`Deputy Board Member ${i + 1}`));
      children.push(...field('Full name', person['Full name']));
      children.push(...field('Date of birth / Social security number', person['Date of birth / Social security number']));
      children.push(...field('Address', person['Address']));
      children.push(...field('Nationality', person['Nationality']));
      children.push(emptyLine());
    });
  } else {
    children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: 'None appointed', font: 'Calibri', size: 22, italics: true, color: '888888' })] }));
  }

  children.push(rule());

  // Section 5: Managing Director
  children.push(heading1('5. Managing Director'));
  if (Array.isArray(managing_director) && managing_director.length > 0 && managing_director[0]['Full name']) {
    managing_director.forEach((person, i) => {
      children.push(...field('Full name', person['Full name']));
      children.push(...field('Date of birth / Social security number', person['Date of birth / Social security number']));
      children.push(...field('Address', person['Address']));
      children.push(...field('Nationality', person['Nationality']));
      children.push(emptyLine());
    });
  } else {
    children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: 'Not appointed', font: 'Calibri', size: 22, italics: true, color: '888888' })] }));
  }

  children.push(rule());

  // Section 6: Authorized Signatory
  children.push(heading1('6. Authorized Signatory'));
  children.push(...field('Authorized signatory', authorized_signatory));

  children.push(rule());

  // Section 7: Auditor
  children.push(heading1('7. Auditor'));
  children.push(...field('Auditor', auditor || 'Not provided'));

  return children;
}

async function generateDocument(templateId, answers) {
  let children;
  let filename;

  if (templateId === 'shelf-company') {
    children = buildShelfCompany(answers);
    const safeName = (answers.entity_name || 'Company').replace(/[^a-z0-9]/gi, '_');
    filename = `CMSW_${safeName}_${Date.now()}.docx`;
  } else {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children
    }]
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, filename);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

module.exports = { generateDocument };
