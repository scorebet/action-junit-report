const core = require('@actions/core');
const github = require('@actions/github');
const { Octokit } = require("@octokit/rest");
const { parseTestReports } = require('./utils.js');

const IDENTIFIER = "23edae2f-afea-4264-b56f-bc94eb0d4ea1"

const action = async () => {
    const reportPaths = core.getInput('report_paths');
    core.info(`Going to parse results form ${reportPaths}`);
    const githubToken = core.getInput('github_token');
    const name = core.getInput('check_name');
    const commit = core.getInput('commit');

    let { count, skipped, annotations } = await parseTestReports(reportPaths);
    const foundResults = count > 0 || skipped > 0;
    const title = foundResults
        ? `${count} tests run, ${skipped} skipped, ${annotations.length} failed.`
        : 'No test results found!';
    core.info(`Result: ${title}`);

    const pullRequest = github.context.payload.pull_request;
    const link = pullRequest && pullRequest.html_url || github.context.ref;
    const conclusion = foundResults && annotations.length === 0 ? 'success' : 'failure';
    const status = 'completed';
    const head_sha = commit || pullRequest && pullRequest.head.sha || github.context.sha;
    core.info(
        `Posting status '${status}' with conclusion '${conclusion}' to ${link} (sha: ${head_sha})`
    );

    const createCheckRequest = {
        ...github.context.repo,
        name,
        head_sha,
        status,
        conclusion,
        output: {
            title,
            summary: '',
            annotations: annotations.slice(0, 50)
        }
    };

    core.debug(JSON.stringify(createCheckRequest, null, 2));

    try {
        const octokit = new Octokit({
            auth: githubToken,
        });
        const checkRequest = await octokit.checks.create(createCheckRequest);

        if (pullRequest) {
            const {
                repo: {repo: repoName, owner: repoOwner},
                runId: runId
            } = github.context
            const defaultParameter = {
                repo: repoName,
                owner: repoOwner
            }
            // Find unique comments
            const {data: comments} = await octokit.issues.listComments({
                ...defaultParameter,
                issue_number: pullRequest.number
            })
            const targetComment = comments.find(c => {
                return c.body.includes(IDENTIFIER)
            })
            // Delete previous comment if exist
            if (targetComment) {
                await octokit.issues.deleteComment({
                    ...defaultParameter,
                    comment_id: targetComment.id
                })
                core.info("Comment successfully delete for id: " + targetComment.id)
            }
            if (conclusion === "failure") {
                const checkId = checkRequest.data.id
                // Create comment
                await octokit.issues.createComment({
                    ...defaultParameter,
                    issue_number: pullRequest.number,
                    body: "Uh-oh! Some of the tests failed: https://github.com/scorebet/sportsbook-android/runs/" + checkId + " <!--  " + IDENTIFIER + " -->"
                })
            }
        }
    } catch (error) {
        core.error(`Failed to create checks using the provided token. (${error})`);
        core.warning(`This usually indicates insufficient permissions. More details: https://github.com/mikepenz/action-junit-report/issues/32`);
    }
};

module.exports = action;
