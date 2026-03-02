const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, WidthType, Table, TableRow, TableCell,
  ShadingType, LevelFormat
} = require('docx');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'generated');

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatMoney(amount) {
  if (!amount) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, bold: true, size: level === HeadingLevel.HEADING_1 ? 28 : 24 })]
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text, ...opts })]
  });
}

function rule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E4057', space: 1 } },
    spacing: { before: 200, after: 200 },
    children: []
  });
}

function signatureBlock(party) {
  return [
    new Paragraph({ spacing: { before: 400, after: 60 }, children: [new TextRun({ text: party, bold: true })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333', space: 1 } },
      spacing: { before: 480, after: 60 }, children: []
    }),
    para('Signature'),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333', space: 1 } },
      spacing: { before: 360, after: 60 }, children: []
    }),
    para('Printed Name'),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333', space: 1 } },
      spacing: { before: 360, after: 60 }, children: []
    }),
    para('Date'),
  ];
}

// ─── Template: Service Agreement ─────────────────────────────────────────────
function buildServiceAgreement(answers) {
  const {
    provider_name, client_name, service_type, service_description,
    payment_type, total_amount, hourly_rate, monthly_rate,
    start_date, end_date, governing_law
  } = answers;

  let paymentClause;
  if (payment_type === 'Fixed Price') {
    paymentClause = `Client agrees to pay Provider a fixed fee of ${formatMoney(total_amount)} for the completion of the Services described herein. Payment terms and milestones shall be agreed upon separately in writing.`;
  } else if (payment_type === 'Hourly Rate') {
    paymentClause = `Client agrees to pay Provider at the rate of ${formatMoney(hourly_rate)} per hour. Provider shall submit invoices on a bi-weekly or monthly basis, and Client shall remit payment within 30 days of receipt.`;
  } else {
    paymentClause = `Client agrees to pay Provider a monthly retainer of ${formatMoney(monthly_rate)}, due on the first business day of each month. This retainer covers the Services as described herein.`;
  }

  const endDateClause = end_date
    ? `This Agreement shall terminate on ${formatDate(end_date)}, unless extended by mutual written consent.`
    : `This Agreement shall continue on a month-to-month basis until terminated by either party with 30 days written notice.`;

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'SERVICE AGREEMENT', bold: true, size: 40, color: '2E4057' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: `Between ${provider_name} and ${client_name}`, size: 22, color: '666666' })] }),
    rule(),

    para(`This Service Agreement ("Agreement") is entered into as of ${formatDate(start_date)}, by and between:`),
    new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: `Provider: `, bold: true }), new TextRun(provider_name)] }),
    new Paragraph({ spacing: { before: 60, after: 200 }, children: [new TextRun({ text: `Client: `, bold: true }), new TextRun(client_name)] }),

    heading('1. Services', HeadingLevel.HEADING_2),
    para(`Provider agrees to perform the following ${service_type} services for Client:`),
    new Paragraph({ spacing: { before: 120, after: 200 }, indent: { left: 720 }, children: [new TextRun({ text: service_description, italics: true })] }),

    heading('2. Term', HeadingLevel.HEADING_2),
    para(`This Agreement commences on ${formatDate(start_date)}. ${endDateClause}`),

    heading('3. Compensation', HeadingLevel.HEADING_2),
    para(paymentClause),

    heading('4. Independent Contractor', HeadingLevel.HEADING_2),
    para(`Provider is an independent contractor and not an employee of Client. Provider shall be responsible for all taxes, insurance, and benefits associated with Provider's engagement.`),

    heading('5. Intellectual Property', HeadingLevel.HEADING_2),
    para(`Upon receipt of full payment, all work product created by Provider under this Agreement shall become the sole and exclusive property of Client. Provider retains the right to display such work in their portfolio.`),

    heading('6. Confidentiality', HeadingLevel.HEADING_2),
    para(`Each party agrees to keep confidential any proprietary or sensitive information disclosed by the other party during the term of this Agreement and for two (2) years thereafter.`),

    heading('7. Limitation of Liability', HeadingLevel.HEADING_2),
    para(`Provider's liability under this Agreement shall not exceed the total compensation paid by Client in the three (3) months preceding any claim. Neither party shall be liable for indirect, incidental, or consequential damages.`),

    heading('8. Governing Law', HeadingLevel.HEADING_2),
    para(`This Agreement shall be governed by and construed in accordance with the laws of ${governing_law}, without regard to its conflict of law provisions.`),

    heading('9. Entire Agreement', HeadingLevel.HEADING_2),
    para(`This Agreement constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior negotiations, representations, warranties, and understandings.`),

    rule(),
    para('IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.'),
    ...signatureBlock(provider_name),
    new Paragraph({ spacing: { before: 200 }, children: [] }),
    ...signatureBlock(client_name),
  ];

  return children;
}

// ─── Template: NDA ───────────────────────────────────────────────────────────
function buildNDA(answers) {
  const { nda_type, party_one, party_two, confidential_info, duration_years, governing_law } = answers;
  const isMutual = nda_type && nda_type.includes('Mutual');
  const parties = `${party_one} and ${party_two}`;
  const disclosureClause = isMutual
    ? `Both parties may disclose Confidential Information to each other.`
    : `${party_one} ("Disclosing Party") may disclose Confidential Information to ${party_two} ("Receiving Party").`;

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'NON-DISCLOSURE AGREEMENT', bold: true, size: 40, color: '1B3A4B' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: isMutual ? 'Mutual Confidentiality Agreement' : 'One-Way Confidentiality Agreement', size: 22, color: '666666' })] }),
    rule(),

    para(`This Non-Disclosure Agreement ("Agreement") is entered into as of ${formatDate(new Date())} by and between ${parties} (collectively, the "Parties").`),
    para(disclosureClause),

    heading('1. Definition of Confidential Information', HeadingLevel.HEADING_2),
    para(`"Confidential Information" means any non-public information disclosed by a party that relates to its business, including but not limited to: ${confidential_info}.`),

    heading('2. Obligations of Confidentiality', HeadingLevel.HEADING_2),
    para(`The receiving party agrees to: (a) hold all Confidential Information in strict confidence; (b) not disclose Confidential Information to any third parties without prior written consent; (c) use Confidential Information solely for the purpose of evaluating a potential business relationship between the Parties; and (d) protect Confidential Information with at least the same degree of care used for its own confidential information, but no less than reasonable care.`),

    heading('3. Exclusions', HeadingLevel.HEADING_2),
    para(`Obligations of confidentiality do not apply to information that: (a) is or becomes publicly known through no breach of this Agreement; (b) was rightfully in the receiving party's possession before disclosure; (c) is required to be disclosed by law or court order; or (d) is independently developed by the receiving party without use of Confidential Information.`),

    heading('4. Term', HeadingLevel.HEADING_2),
    para(`This Agreement shall remain in effect for ${duration_years} from the date of execution, unless terminated earlier by mutual written consent.`),

    heading('5. Return of Information', HeadingLevel.HEADING_2),
    para(`Upon request or termination of this Agreement, each receiving party shall promptly return or destroy all Confidential Information and any copies thereof.`),

    heading('6. Governing Law', HeadingLevel.HEADING_2),
    para(`This Agreement shall be governed by the laws of ${governing_law}.`),

    rule(),
    para('IN WITNESS WHEREOF, the Parties have executed this Non-Disclosure Agreement as of the date first written above.'),
    ...signatureBlock(party_one),
    new Paragraph({ spacing: { before: 200 }, children: [] }),
    ...signatureBlock(party_two),
  ];

  return children;
}

// ─── Template: Employment Offer ──────────────────────────────────────────────
function buildEmploymentOffer(answers) {
  const {
    company_name, candidate_name, job_title, employment_type,
    annual_salary, hourly_wage, contract_rate, start_date,
    benefits, reporting_to
  } = answers;

  let compClause;
  if (employment_type === 'Full-Time') {
    compClause = `Your annual base salary will be ${formatMoney(annual_salary)}, paid bi-weekly in accordance with the Company's standard payroll schedule.`;
  } else if (employment_type === 'Part-Time') {
    compClause = `Your hourly wage will be ${formatMoney(hourly_wage)} per hour.`;
  } else {
    compClause = `Your compensation will be ${contract_rate}, as agreed upon in the associated contract.`;
  }

  const benefitsList = Array.isArray(benefits) && benefits.length > 0
    ? benefits.join(', ')
    : 'to be discussed separately';

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: company_name.toUpperCase(), bold: true, size: 32, color: '1A1A2E' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: 'OFFER OF EMPLOYMENT', size: 28, color: '444466' })] }),
    rule(),

    new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: `Date: ${formatDate(new Date())}` })] }),
    new Paragraph({ spacing: { before: 80, after: 200 }, children: [new TextRun({ text: `Dear ${candidate_name},` })] }),

    para(`On behalf of ${company_name}, I am pleased to offer you the position of ${job_title} (${employment_type}). We believe your skills and experience will make a valuable addition to our team.`),

    heading('Position Details', HeadingLevel.HEADING_2),
    new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: 'Job Title: ', bold: true }), new TextRun(job_title)] }),
    new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun({ text: 'Employment Type: ', bold: true }), new TextRun(employment_type)] }),
    new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun({ text: 'Start Date: ', bold: true }), new TextRun(formatDate(start_date))] }),
    ...(reporting_to ? [new Paragraph({ spacing: { before: 60, after: 200 }, children: [new TextRun({ text: 'Reporting To: ', bold: true }), new TextRun(reporting_to)] })] : [new Paragraph({ spacing: { before: 60, after: 200 }, children: [] })]),

    heading('Compensation', HeadingLevel.HEADING_2),
    para(compClause),

    heading('Benefits', HeadingLevel.HEADING_2),
    para(`As a ${employment_type} employee, you will be eligible for the following benefits: ${benefitsList}. Full details will be provided in the employee handbook and during onboarding.`),

    heading('Conditions of Employment', HeadingLevel.HEADING_2),
    para(`This offer is contingent upon: (a) successful completion of a background check; (b) verification of your legal right to work in the applicable jurisdiction; and (c) execution of the Company's standard Employee Confidentiality and IP Assignment Agreement.`),

    heading('At-Will Employment', HeadingLevel.HEADING_2),
    para(`Your employment with ${company_name} is at-will, meaning either you or the Company may terminate the employment relationship at any time, with or without cause or notice, subject to applicable law.`),

    para(`We are excited about the possibility of you joining our team. Please sign below to indicate your acceptance of this offer no later than 7 business days from the date of this letter.`),

    rule(),
    para('Please sign and return one copy to indicate your acceptance.'),
    new Paragraph({ spacing: { before: 400, after: 60 }, children: [new TextRun({ text: 'Sincerely,', })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333', space: 1 } },
      spacing: { before: 400, after: 60 }, children: []
    }),
    para(`Authorized Representative, ${company_name}`),
    new Paragraph({ spacing: { before: 400 }, children: [] }),
    ...signatureBlock(`${candidate_name} — Acceptance`),
  ];

  return children;
}

// ─── Main Generator ──────────────────────────────────────────────────────────
async function generateDocument(templateId, answers) {
  let children;
  let filename;

  if (templateId === 'service-agreement') {
    children = buildServiceAgreement(answers);
    filename = `Service_Agreement_${Date.now()}.docx`;
  } else if (templateId === 'nda') {
    children = buildNDA(answers);
    filename = `NDA_${Date.now()}.docx`;
  } else if (templateId === 'employment-offer') {
    children = buildEmploymentOffer(answers);
    filename = `Employment_Offer_${Date.now()}.docx`;
  } else {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } }
      },
      paragraphStyles: [
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Calibri', color: '2E4057' },
          paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 }
        }
      ]
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
