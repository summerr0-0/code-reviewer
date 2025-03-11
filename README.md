# code-reviewer

chatGPT를 활용한 코드 리뷰 봇

## 사용법
- github action을 사용하기 위해서는 .github/workflows 디렉토리에 yml 파일을 추가해야 함

- 코드 리뷰어 수정시 src/index.ts 파일을 수정하고 다음 명령어를 실행
- dist 디렉토리에 빌드된 파일까지 커밋해야 함
```
npx ncc build src/index.ts -o dist;
```


[참고레포지토리](https://github.com/hyunho058/code-reviewer)   
[github doc](https://docs.github.com/ko/rest/pulls/reviews?apiVersion=2022-11-28#create-a-review-for-a-pull-request)   
[테스트용 레포지토리](https://github.com/summerr0-0/code-review-test) 를 확인하면 실제 동작하는 코드 리뷰 봇을 확인할 수 있습니다.