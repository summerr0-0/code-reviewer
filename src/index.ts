import {readFileSync} from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import {Octokit} from "@octokit/rest";
import parseDiff, {File} from "parse-diff";
import { minimatch } from "minimatch";

// GitHub API 토큰과 OpenAI API 키 설정
// GitHub Actions에서 설정한 환경변수를 가져와 API 접근 권한 확보
const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");

// API 클라이언트 초기화: GitHub API와 OpenAI API 클라이언트 설정
// 두 API를 통해 PR 정보 가져오기 및 AI 리뷰 생성이 가능해짐
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

interface PRDetails {
    owner: string;
    repo: string;
    pull_number: number;
    title: string;
    description: string;
}

// PR 정보 추출 함수: GitHub 이벤트에서 PR 세부 정보 가져오기
// GitHub Actions 실행 시 생성되는 이벤트 파일에서 PR 정보를 파싱
async function getPRDetails(): Promise<PRDetails> {
    // GitHub 이벤트 파일에서 PR 정보 읽어오기
    const eventData = JSON.parse(
        readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
    );
    const { repository, number } = eventData;

    // PR 정보 가져오기
    const prResponse = await octokit.pulls.get({
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: number,
    });

    return {
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: number,
        title: prResponse.data.title ?? "",
        description: prResponse.data.body ?? "",
    };
}

// Diff 추출 함수: PR의 코드 변경사항(diff) 가져오기
// PR 이벤트 타입(opened/synchronize)에 따라 적절한 방식으로 diff 정보 획득
async function getDiff(
    owner: string,
    repo: string,
    pull_number: number,
    eventData: any
): Promise<string | null> {
    // opened/synchronize 등에 따라 diff 가져오기
    //opened : pr생성 후 최초 커밋을 했을 때 업데이트되는 이벤트
    //synchronize : pr생성 후 새로운 커밋을 했을 때 업데이트되는 이벤트
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
        // compareCommits로 diff 가져오기
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
        core.info(`Unsupported event: ${eventData.action}`);
        return null;
    }
}

// 롬프트 생성 함수: OpenAI에 전달할 체계화된 프롬프트 설계
// AI가 구조화된 리뷰를 생성하도록 템플릿 형태의 프롬프트 제공
function createPrompt(aggregatedDiff: string, prDetails: PRDetails): string {
    // Python 코드의 create_prompt와 동일한 아이디어:
    // 전체 diff를 하나로 합쳐 단일 리뷰 요청.
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

// AI 리뷰 생성 함수: OpenAI API를 통해 코드 리뷰 생성
// 프롬프트를 전달하고 응답을 받아 정제하는 핵심 함수
async function getAiReviewText(prompt: string): Promise<string> {
    try {
        const response = await openai.chat.completions.create({
            model: OPENAI_API_MODEL,
            messages: [{ role: "system", content: prompt }],
            max_tokens: 1000,
            temperature: 0.2,
        });

        let content = response.choices[0].message?.content || "";
        // 코드 펜스 제거
        content = content.replace(/```(\w+)?/g, "").replace(/```/g, "").trim();
        return content;
    } catch (error) {
        core.error(`Error getting AI response: ${error}`);
        return "";
    }
}

// 통합 Diff 생성 함수: 개별 파일 diff를 하나로 통합
// 분석을 위해 여러 파일의 변경사항을 하나의 문자열로 통합
function createAggregatedDiff(parsedDiff: File[]): string {
    const lines: string[] = [];

    for (const file of parsedDiff) {
        if (file.to === "/dev/null") {
            continue;
        }
        // 파일 헤더(선택)
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

// 코멘트 생성 함수: GitHub PR에 리뷰 코멘트 작성
// 생성된 AI 리뷰를 PR에 코멘트로 게시하는 기능
async function createIssueComment(
    owner: string,
    repo: string,
    pull_number: number,
    body: string
) {
    core.info(`Creating single issue comment for PR #${pull_number}`);
    try {
        const response = await octokit.issues.createComment({
            owner,
            repo,
            issue_number: pull_number,
            body,
        });
        if (response.status === 201) {
            core.info("Issue comment created successfully.");
        }
    } catch (err) {
        core.error(`Failed to create issue comment: ${err}`);
    }
}

// 통합 코드 분석 함수: diff 분석과 AI 리뷰를 통합 처리
// 코드 변경사항을 분석하고 AI 리뷰를 생성하는 주요 프로세스
async function analyzeCodeSingleReview(
    parsedDiff: File[],
    prDetails: PRDetails
): Promise<string> {
    // 1) 전체 추가 라인을 합쳐 aggregatedDiff 생성
    const aggregatedDiff = createAggregatedDiff(parsedDiff);

    if (!aggregatedDiff) {
        return "";
    }

    // 2) 프롬프트 생성
    const prompt = createPrompt(aggregatedDiff, prDetails);

    // 3) AI 리뷰 텍스트 받기
    const reviewText = await getAiReviewText(prompt);
    return reviewText;
}

// 메인 실행 함수: 전체 워크플로우 조정 및 실행
// GitHub Actions에서 실행될 때 전체 프로세스를 조율하는 메인 함수
async function index(): Promise<void> {
    try {
        //PR 정보 수집: PR 세부 정보와 이벤트 데이터 로드
        const prDetails = await getPRDetails();
        const eventData = JSON.parse(
            readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
        );

        // Diff 정보 획득: PR의 코드 변경사항 가져오기
        const diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number, eventData);
        if (!diff) {
            core.info("No diff found.");
            return;
        }

        // parse-diff로 diff 파싱
        const parsedDiff = parseDiff(diff);

        // exclude 패턴 처리 (optional)
        const excludePatterns = core
            .getInput("exclude")
            .split(",")
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);

        const filteredDiff = parsedDiff.filter((file) => {
            return !excludePatterns.some((pattern: string) =>
                minimatch(file.to ?? "", pattern)
            );
        });

        //코드 분석 및 리뷰 생성: AI를 통한 코드 분석 실행
        // 단일 종합 리뷰 생성
        const reviewText = await analyzeCodeSingleReview(filteredDiff, prDetails);

        //결과 게시: 분석 결과를 GitHub PR에 게시
        if (reviewText) {
            // 하나의 이슈 코멘트로 작성
            await createIssueComment(
                prDetails.owner,
                prDetails.repo,
                prDetails.pull_number,
                reviewText
            );
        } else {
            core.info("No comments generated by AI.");
        }
    } catch (error) {
        core.error(`Error: ${error}`);
        process.exit(1);
    }
}

//실행
index();