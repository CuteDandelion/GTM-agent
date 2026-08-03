#!/usr/bin/env ruby

require "xcodeproj"

mobile_root = File.expand_path("..", __dir__)
project_path = File.join(mobile_root, "ios", "GTMResearchAgent.xcodeproj")
source_path = File.join(mobile_root, "native-e2e", "GTMResearchAgentUITests.swift")

abort "Run Expo prebuild before configuring the UI-test target" unless File.exist?(project_path)

project = Xcodeproj::Project.open(project_path)
app_target = project.targets.find { |target| target.name == "GTMResearchAgent" }
abort "GTMResearchAgent target was not found" unless app_target

test_target = project.targets.find { |target| target.name == "GTMResearchAgentUITests" }
test_target ||= project.new_target(:ui_test_bundle, "GTMResearchAgentUITests", :ios, "16.0")
test_target.add_dependency(app_target) unless test_target.dependencies.any? { |dependency| dependency.target == app_target }

test_group = project.main_group.find_subpath("GTMResearchAgentUITests", true)
source_reference = test_group.files.find { |file| file.real_path.to_s == source_path }
source_reference ||= test_group.new_file(source_path)
unless test_target.source_build_phase.files_references.include?(source_reference)
  test_target.add_file_references([source_reference])
end

test_target.build_configurations.each do |configuration|
  configuration.build_settings["CODE_SIGNING_ALLOWED"] = "NO"
  configuration.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  configuration.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.cutedandelion.gtmresearch.uitests"
  configuration.build_settings["PRODUCT_NAME"] = "$(TARGET_NAME)"
  configuration.build_settings["SWIFT_VERSION"] = "5.0"
  configuration.build_settings["TARGETED_DEVICE_FAMILY"] = "1"
  configuration.build_settings["TEST_TARGET_NAME"] = "GTMResearchAgent"
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app_target, test_target, launch_target: app_target)
scheme.test_action.should_use_launch_scheme_args_env = false

test_environment = Xcodeproj::XCScheme::EnvironmentVariables.new
{
  "NATIVE_E2E_MODE" => ENV["NATIVE_E2E_MODE"],
  "NATIVE_E2E_EMAIL" => ENV["NATIVE_E2E_EMAIL"],
  "NATIVE_E2E_PASSWORD" => ENV["NATIVE_E2E_PASSWORD"],
}.each do |key, value|
  next if value.nil? || value.empty?

  variable = Xcodeproj::XCScheme::EnvironmentVariable.new(key: key, value: value, enabled: true)
  test_environment.assign_variable(variable)
end
scheme.test_action.environment_variables = test_environment unless test_environment.all_variables.empty?
scheme.save_as(project_path, "GTMResearchAgentNativeE2E", true)

puts "Configured GTMResearchAgentNativeE2E"
