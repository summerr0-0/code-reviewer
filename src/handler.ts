import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import parseDiff, { File } from "parse-diff";
import { minimatch } from "minimatch";

// API 클라이언트 초기화
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // GitHub Webhook 이벤트 처리
    const payload = JSON.parse(event.body || '{}');
    const githubToken = process.env.GITHUB_TOKEN;
    const openaiModel = process.env.OPENAI_API_MODEL || "gpt-4";
    
    // GitHub 이벤트 타입 확인 (pull_request 이벤트만 처리)
    if (payload.action !== 'opened' && payload.action !== 'synchronize') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Unsupported event type' })
      };
    }
    
    const octokit = new Octokit({ auth: githubToken });
    const prDetails = {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.pull_request.number,
      title: payload.pull_request.title,
      description: payload.pull_request.body || '',
    };
    
    // PR diff 가져오기
    const diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number, 
      payload,
      octokit
    );
    
    if (!diff) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No diff found' })
      };
    }
    
    // parse-diff로 diff 파싱
    const parsedDiff = parseDiff(diff);
    
    // exclude 패턴 (환경 변수에서 가져옴)
    const excludePatterns = (process.env.EXCLUDE_PATTERNS || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    const filteredDiff = parsedDiff.filter(file => {
      return !excludePatterns.some(pattern =>
        minimatch(file.to ?? '', pattern)
      );
    });
    
    // 코드 분석 및 리뷰 생성
    const reviewText = await analyzeCodeSingleReview(filteredDiff, prDetails, openaiModel);
    
    // GitHub PR에 코멘트 작성
    if (reviewText) {
      await createIssueComment(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number,
        reviewText,
        octokit
      );
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Review completed successfully' })
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error processing webhook', error: String(error) })
    };
  }
};

// diff 가져오기 함수
async function getDiff(
  owner: string,
  repo: string,
  pull_number: number,
  eventData: any,
  octokit: Octokit
): Promise<string | null> {
  if (eventData.action === "opened") {
    const response = await octokit.pulls.get({
      owner,
      repo,
      pull_number,
      mediaType: { format: "diff" },
    });
    // @ts-expect-error - response.data is a string (diff)
    return response.data;
  } else if (eventData.action === "synchronize") {
    const baseSha = eventData.before;
    const headSha = eventData.after;
    const response = await octokit.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
    });
    return String(response.data);
  } else {
    console.info(`Unsupported event: ${eventData.action}`);
    return null;
  }
}

// 프롬프트 생성 함수
function createPrompt(aggregatedDiff: string, prDetails: any): string {
  return `
You are an automated code review assistant. Your review output **must** follow the structure below **exactly**:

[AI Review]

**1.개요**
(이 Pull Request의 요약 및 주요 변경 사항을 간단히 설명)

**2.분석 영역**

2.1 런타임 오류 검사
(런타임 에러 가능성, NPE, IndexError 등)

2.2 성능 최적화
(비효율적인 루프, 불필요한 연산, 리소스 낭비, DB 호출 최적화 등)

2.3 코드 스타일 및 가독성
(가독성, 네이밍, 불필요한 코드, 포맷팅, 클래스/메서드 분리 등)

2.4 취약점 분석
- 접근 통제 취약점
- 암호화 실패
- 인젝션
- 안전하지 않은 설계
- 보안 설정 오류
- 취약하고 오래된 구성요소
- 식별 및 인증 실패
- 소프트웨어 및 데이터 무결성 실패
- 보안 로깅 및 모니터링 실패
- 서버 사이드 요청 위조(SSRF)
- 사용되지 않거나 안전하지 않은 모듈 사용
- 검증되지 않은 입력 처리
- 민감한 데이터의 부적절한 처리
- 민감한 정보 노출 (예: 하드코딩된 비밀번호)
- 기타 보안 위험

(위 항목들 중 발견된 취약점 또는 개선 사항이 있으면 제시하고, 없다면 '결과: 취약점 없음' 식으로 표기)

**3.종합 의견**
(최종 요약 및 의견 제시)

##중요##:
- 절대로 코드블록(\`\`\`)이나 JSON 포맷이 아닌 **위의 텍스트 구조** 그대로만 출력하세요.
- **긍정적 코멘트나 칭찬은 작성하지 말고**, 개선점이 있는 경우에만 작성하세요.
- 만약 개선할 점이 전혀 없다면, 2번 항목(분석 영역)에서 각 섹션에 "발견되지 않음"이라고 쓰고, 3번 항목에서도 별도 개선점 없이 마무리하세요.
- **2.분석 영역 항목에 대한 의견을 작성할때는 다음과 같이 코드 블록을 작성하세요** **(예시):

수정 전:
\`\`\`java
기존 java 코드블럭
\`\`\`

수정 후:
\`\`\`java
개선된 java 코드블럭
\`\`\`

Pull request title: ${prDetails.title}
Pull request description:
---
${prDetails.description}
---

아래는 Pull Request에서 변경된 코드 diff 전체입니다:
(diff 시작)
${aggregatedDiff}
(diff 끝)

분석 결과를 위의 구조대로 작성해주세요.
`.trim();
}

// AI 리뷰 생성 함수
async function getAiReviewText(prompt: string, model: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: "system", content: prompt }],
      max_tokens: 1000,
      temperature: 0.2,
    });

    let content = response.choices[0].message?.content || "";
    // 코드 펜스 제거
    content = content.replace(/```(\w+)?/g, "").replace(/```/g, "").trim();
    return content;
  } catch (error) {
    console.error(`Error getting AI response: ${error}`);
    return "";
  }
}

// 통합 Diff 생성 함수
function createAggregatedDiff(parsedDiff: File[]): string {
  const lines: string[] = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") {
      continue;
    }
    // 파일 헤더
    lines.push(`diff --git a/${file.from} b/${file.to}`);

    for (const hunk of file.chunks) {
      for (const change of hunk.changes) {
        if ('add' in change && change.add) {
          // 추가된 라인에 "+" 표시
          lines.push(`+ ${change.content.replace(/\r?\n$/, "")}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// 코멘트 생성 함수
async function createIssueComment(
  owner: string,
  repo: string,
  pull_number: number,
  body: string,
  octokit: Octokit
) {
  console.info(`Creating issue comment for PR #${pull_number}`);
  try {
    const response = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body,
    });
    if (response.status === 201) {
      console.info("Issue comment created successfully.");
    }
  } catch (err) {
    console.error(`Failed to create issue comment: ${err}`);
  }
}

// 통합 코드 분석 함수
async function analyzeCodeSingleReview(
  parsedDiff: File[],
  prDetails: any,
  model: string
): Promise<string> {
  // 전체 추가 라인을 합친 aggregatedDiff 생성
  const aggregatedDiff = createAggregatedDiff(parsedDiff);

  if (!aggregatedDiff) {
    return "";
  }

  // 프롬프트 생성
  const prompt = createPrompt(aggregatedDiff, prDetails);

  // AI 리뷰 텍스트 받기
  const reviewText = await getAiReviewText(prompt, model);
  return reviewText;
}
