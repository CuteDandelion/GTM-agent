-- Version aligned with the applied remote migration ledger.
create index claims_company_idx on public.claims(company_id);
create index claims_owner_idx on public.claims(owner_id);

create index conversations_icp_definition_idx on public.conversations(icp_definition_id);
create index conversations_seller_profile_idx on public.conversations(seller_profile_id);

create index evidence_company_idx on public.evidence(company_id);
create index evidence_owner_idx on public.evidence(owner_id);

create index feedback_events_interactive_object_idx on public.feedback_events(interactive_object_id);
create index feedback_events_owner_idx on public.feedback_events(owner_id);

create index icp_assessments_icp_definition_idx on public.icp_assessments(icp_definition_id);
create index icp_assessments_owner_idx on public.icp_assessments(owner_id);
create index icp_assessments_workflow_run_idx on public.icp_assessments(workflow_run_id);

create index interactive_objects_message_idx on public.interactive_objects(message_id);
create index interactive_objects_owner_idx on public.interactive_objects(owner_id);

create index messages_owner_idx on public.messages(owner_id);
create index model_invocations_owner_idx on public.model_invocations(owner_id);

create index node_artifacts_attempt_idx on public.node_artifacts(node_attempt_id);
create index node_artifacts_owner_idx on public.node_artifacts(owner_id);
create index node_attempts_owner_idx on public.node_attempts(owner_id);

create index node_dependencies_depends_on_idx on public.node_dependencies(depends_on_node_id);
create index node_dependencies_owner_idx on public.node_dependencies(owner_id);

create index opportunities_icp_assessment_idx on public.opportunities(icp_assessment_id);
create index opportunities_owner_idx on public.opportunities(owner_id);
create index opportunities_workflow_run_idx on public.opportunities(workflow_run_id);

create index research_artifacts_owner_idx on public.research_artifacts(owner_id);
create index research_artifacts_run_owner_idx on public.research_artifacts(workflow_run_id, owner_id);

create index tool_invocations_owner_idx on public.tool_invocations(owner_id);

create index workflow_checkpoints_owner_idx on public.workflow_checkpoints(owner_id);
create index workflow_checkpoints_run_owner_idx on public.workflow_checkpoints(workflow_run_id, owner_id);

create index workflow_nodes_owner_idx on public.workflow_nodes(owner_id);

create index workflow_runs_company_idx on public.workflow_runs(company_id);
create index workflow_runs_conversation_idx on public.workflow_runs(conversation_id);
create index workflow_runs_template_idx on public.workflow_runs(workflow_template_id);
