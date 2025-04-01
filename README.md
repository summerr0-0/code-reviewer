# GitHub Code Reviewer Bot

AWS Bedrock을 활용한 코드 리뷰 봇

## 개요

이 프로젝트는 GitHub Pull Request에 대한 자동 코드 리뷰를 제공하는 AWS Lambda 기반 서비스입니다. AWS Bedrock의 AI 모델을 사용하여 코드 변경 사항을 분석하고 품질, 보안, 성능에 대한 인사이트를 제공합니다.

## 주요 기능

- GitHub Webhook을 통한 Pull Request 이벤트 캡처 (PR 생성 또는 업데이트)
- AWS Bedrock으로 코드 diff 분석
- 자동 코드 리뷰 코멘트 생성 (런타임 오류, 성능, 스타일, 취약점 분석)
- AWS Lambda를 통한 서버리스 배포

## 설치 및 설정

### 사전 요구사항

- AWS 계정 (Bedrock 접근 권한 필요)
- GitHub 리포지토리 관리자 권한
- Node.js 16 이상

### 로컬 설정

```bash
# 저장소 클론
git clone https://github.com/yourusername/code-reviewer.git
cd code-reviewer

# 종속성 설치
npm install

# 빌드
npm run build
```

### AWS 설정

1. AWS IAM에서 다음 권한이 있는 사용자 생성:
   - Lambda 함수 관리
   - Bedrock 모델 호출

2. AWS Lambda 함수 생성:
   - 런타임: Node.js 16.x 이상
   - 핸들러: index.handler
   - 환경 변수:
     - GITHUB_TOKEN: GitHub 개인 액세스 토큰
     - AWS_REGION: Bedrock 서비스 리전 (기본값: us-east-1)
     - BEDROCK_MODEL_ID: 사용할 Bedrock 모델 ID (기본값: anthropic.claude-3-haiku-20240307-v1:0)
     - EXCLUDE_PATTERNS: 리뷰에서 제외할 파일 패턴(쉼표로 구분)

3. GitHub Webhook 설정:
   - 리포지토리 설정 > Webhooks > Add webhook
   - Payload URL: Lambda 함수 URL 또는 API Gateway 엔드포인트
   - Content type: application/json
   - Secret: (선택 사항) 보안을 위한 시크릿 설정
   - 이벤트: "Pull requests" 이벤트 선택

### GitHub Actions 배포

이 프로젝트는 GitHub Actions를 통한 CI/CD 파이프라인을 포함하고 있습니다. 다음 시크릿을 GitHub 리포지토리에 설정해야 합니다:

- AWS_ACCESS_KEY_ID: AWS 액세스 키
- AWS_SECRET_ACCESS_KEY: AWS 시크릿 키
- AWS_REGION: AWS 리전 (기본값: us-east-1)
- GH_TOKEN: GitHub 개인 액세스 토큰
- BEDROCK_MODEL_ID: (선택 사항) 사용할 Bedrock 모델 ID

## 사용법

1. Pull Request 생성 또는 업데이트 시 자동으로 코드 리뷰 실행
2. 리뷰 코멘트가 PR에 자동으로 추가됨
3. 리뷰는 다음 영역을 분석:
   - 런타임 오류 검사
   - 성능 최적화
   - 코드 스타일 및 가독성
   - 취약점 분석

## AWS Bedrock 모델 옵션

현재 지원되는 모델:
- anthropic.claude-3-haiku-20240307-v1:0 (기본)
- anthropic.claude-3-sonnet-20240229-v1:0
- anthropic.claude-3-opus-20240229-v1:0
- amazon.titan-text-express-v1
- ai21.j2-ultra-v1

환경 변수 `BEDROCK_MODEL_ID`를 통해 사용할 모델을 지정할 수 있습니다.

## 개발 및 빌드

- 코드 수정 후 빌드 및 패키징:
```bash
npm run build
npm run package
```

- 배포 (GitHub Actions 또는 수동):
```bash
# 수동 배포
cd dist && zip -r index.js.zip index.js
aws lambda update-function-code --function-name YOUR_FUNCTION_NAME --zip-file fileb://index.js.zip
```

## 참고 링크

- [GitHub API 문서](https://docs.github.com/ko/rest/pulls/reviews)
- [AWS Bedrock 문서](https://docs.aws.amazon.com/bedrock/)
- [테스트용 레포지토리](https://github.com/summerr0-0/code-review-test) - 실제 동작하는 코드 리뷰 봇 확인 가능