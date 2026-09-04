const { google } = require('googleapis');

exports.handler = async function(event, context) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 요청하신 시트 ID와 4개의 한글 시트 이름을 적용했습니다.
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: '1nhATTYkTWrro8UDRNsUMmjrNbnyZ1LvTfZf9dzllkTY',
      ranges: [
        '신청서별허가현황!A1:Z', 
        '납부현황목록!A1:Z', 
        '수동맵핑!A1:Z', 
        '환수사후납정리!A1:Z'
      ], 
    });

    const allData = response.data.valueRanges;
    
    // 프론트엔드에서 알아보기 쉽게 각 시트별로 데이터를 매핑합니다.
    // 데이터가 비어있을 경우 에러가 나지 않도록 (|| []) 빈 배열을 기본값으로 줍니다.
    const resultData = {
      approvalStatus: allData[0].values || [],  // 신청서별허가현황
      paymentList: allData[1].values || [],     // 납부현황목록
      manualMapping: allData[2].values || [],   // 수동맵핑
      refundAdjustment: allData[3].values || [] // 환수사후납정리
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, data: resultData }),
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: false, message: "데이터를 가져오지 못했습니다.", error: error.message }),
    };
  }
};